import type { TrendSourceItem } from './_types.js';

// ── @makers/jev — Makers System One decision model client ─────────
//
// jev is NOT a chat model: it evaluates a `state` against a set of
// strongly-typed questions (noul / choice / score) and returns
// structured decisions. It only works on the dedicated
// `/v1/systemone` endpoint — not /v1/chat/completions.
// Docs: https://pages.edgeone.ai/zh/document/using-the-jev-model

/** AI 硬件分类体系（与 _sources.ts 的 CATEGORY_KEYWORDS、前端 TOPICS 保持一致） */
export const HW_CATEGORIES = [
  'Robotics',
  'AI Chips',
  'Wearables & XR',
  'Edge AI',
  'Smart Devices',
  'AI Hardware Industry',
] as const;

export type JevQuestionType = 'noul' | 'choice' | 'score';

export interface JevQuestion {
  type: JevQuestionType;
  instructions: string;
  /** choice: option id → description; score: tier legend */
  criteria?: Record<string, string>;
}

interface JevAnswerBox {
  noul?: number;
  choice?: string;
  probability?: number;
  confidence?: number;
}

export interface JevItemDecision {
  /** 与 AI 硬件直接相关（noul ≥ 0.5） */
  relevant: boolean;
  /** 质量判断：非招聘/营销/低质量（noul ≥ 0.5） */
  keep: boolean;
  /** jev 判定的子领域 */
  category: string;
  /** AI 硬件相关概率（0~1），用于日志 */
  relevanceP: number;
}

function resolveJevEndpoint(env: Record<string, string | undefined>): { url: string; apiKey: string } | null {
  const apiKey = env.LLM_API_KEY || env.AI_GATEWAY_API_KEY || env.OPENAI_API_KEY;
  if (!apiKey) return null;
  const baseUrl = (env.LLM_BASE_URL || env.AI_GATEWAY_BASE_URL || 'https://ai-gateway.edgeone.link').replace(/\/+$/, '');
  // Gateway base may already end with /v1 — normalize to the systemone endpoint
  const root = baseUrl.replace(/\/v1$/, '');
  return { url: `${root}/v1/systemone`, apiKey };
}

/**
 * Low-level jev call. Returns the per-question answer boxes, or null on any
 * failure (missing key, HTTP error, timeout, unexpected shape) — callers must
 * degrade gracefully to the keyword/heuristic fallbacks.
 */
async function callJev(
  env: Record<string, string | undefined>,
  state: unknown,
  questions: Record<string, JevQuestion>,
  signal?: AbortSignal,
  timeoutMs = 45000,
): Promise<Record<string, JevAnswerBox> | JevAnswerBox[] | null> {
  const endpoint = resolveJevEndpoint(env);
  if (!endpoint) return null;

  const timeoutController = new AbortController();
  const timer = setTimeout(() => timeoutController.abort(), timeoutMs);
  const onExternalAbort = () => timeoutController.abort();
  signal?.addEventListener('abort', onExternalAbort);

  try {
    const res = await fetch(endpoint.url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${endpoint.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model: '@makers/jev', state, questions }),
      signal: timeoutController.signal,
    });
    if (!res.ok) {
      console.warn(`[jev] HTTP ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
      return null;
    }
    const data = await res.json().catch(() => null) as { answers?: unknown } | null;
    const answers = (data as { answers?: unknown })?.answers;
    if (!answers || typeof answers !== 'object') {
      console.warn('[jev] unexpected response shape (no answers object)');
      return null;
    }
    return answers as Record<string, JevAnswerBox> | JevAnswerBox[];
  } catch (err: any) {
    if (err?.name === 'AbortError' && signal?.aborted) throw err; // user abort — propagate
    console.warn(`[jev] call failed: ${err?.message || err}`);
    return null;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onExternalAbort);
  }
}

function readNoul(box: JevAnswerBox | undefined): number | null {
  const value = box?.noul ?? box?.probability;
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readChoice(box: JevAnswerBox | undefined): string | null {
  const value = box?.choice;
  return typeof value === 'string' && value ? value : null;
}

/** Batch size per jev call — keeps each request small and failure blast radius low */
const JEV_CHUNK_SIZE = 40;

function toCompactState(items: TrendSourceItem[]) {
  return items.map(item => ({
    id: item.id,
    title: item.title,
    summary: (item.summary || '').slice(0, 200),
    source: item.source || '',
    engagement: item.score ?? 0,
  }));
}

/**
 * Evaluate a batch of candidate items with jev: AI-hardware relevance,
 * quality (keep/drop) and category assignment. Returns a Map keyed by item
 * id, or null when jev is unavailable — callers must fall back.
 */
export async function evaluateItemsWithJev(
  env: Record<string, string | undefined>,
  items: TrendSourceItem[],
  signal?: AbortSignal,
): Promise<Map<string, JevItemDecision> | null> {
  if (!items.length) return new Map();

  const questions: Record<string, JevQuestion> = {
    is_ai_hardware: {
      type: 'noul',
      instructions: '该条内容与 AI 硬件直接相关：机器人/具身智能、芯片与算力硬件、可穿戴与XR设备、端侧AI设备（AI PC/AI手机/智驾）、智能家居与IoT硬件、AI硬件行业动态。纯软件/算法/模型发布且不涉及硬件落地的内容判为 no。',
    },
    should_keep: {
      type: 'noul',
      instructions: '该内容值得保留：真实的产品/技术/行业动态。纯招聘帖、营销软文、重复低质量内容判为 no。',
    },
    category: {
      type: 'choice',
      instructions: '为该内容选择最贴切的 AI 硬件子领域',
      criteria: {
        'Robotics': '人形机器人、具身智能、四足/工业/服务机器人、无人机、机器人零部件',
        'AI Chips': 'GPU/NPU/ASIC/TPU、半导体、先进制程与封装、服务器与算力集群、芯片厂商动态',
        'Wearables & XR': 'AI眼镜、AR/VR/MR头显、智能手表/耳机/AI Pin等穿戴设备',
        'Edge AI': '端侧模型部署、AI PC、AI手机、智能驾驶与车载硬件、边缘计算设备',
        'Smart Devices': '智能家居、IoT设备、AI玩具/陪伴机器人、消费级智能硬件新品',
        'AI Hardware Industry': '融资并购、供应链、政策展会等不明确属于上述领域的行业动态',
      },
    },
  };

  const decisions = new Map<string, JevItemDecision>();

  for (let i = 0; i < items.length; i += JEV_CHUNK_SIZE) {
    const chunk = items.slice(i, i + JEV_CHUNK_SIZE);
    const answers = await callJev(env, toCompactState(chunk), questions, signal);
    if (!answers) return null; // jev unavailable — let caller fall back wholesale

    // Two possible batch shapes: per-item array aligned with state, or
    // per-question arrays. Handle both defensively; bail on mismatch.
    let extracted: Array<{ relevant: boolean; keep: boolean; category: string; relevanceP: number }>;
    if (Array.isArray(answers)) {
      if (answers.length !== chunk.length) return null;
      extracted = answers.map(box => extractDecision({
        is_ai_hardware: (box as Record<string, JevAnswerBox> | undefined)?.is_ai_hardware,
        should_keep: (box as Record<string, JevAnswerBox> | undefined)?.should_keep,
        category: (box as Record<string, JevAnswerBox> | undefined)?.category,
      }));
    } else {
      const rel = answers.is_ai_hardware;
      const keep = answers.should_keep;
      const cat = answers.category;
      if (!Array.isArray(rel) || !Array.isArray(keep) || !Array.isArray(cat)
        || rel.length !== chunk.length || keep.length !== chunk.length || cat.length !== chunk.length) {
        console.warn('[jev] unexpected batch answer shape, falling back');
        return null;
      }
      extracted = chunk.map((_, j) => extractDecision({
        is_ai_hardware: rel[j] as JevAnswerBox,
        should_keep: keep[j] as JevAnswerBox,
        category: cat[j] as JevAnswerBox,
      }));
    }

    chunk.forEach((item, j) => {
      decisions.set(item.id, extracted[j]);
    });
  }

  return decisions;
}

function extractDecision(
  boxes: { is_ai_hardware?: JevAnswerBox; should_keep?: JevAnswerBox; category?: JevAnswerBox },
): JevItemDecision {
  const relevanceP = readNoul(boxes.is_ai_hardware) ?? 0;
  const keepP = readNoul(boxes.should_keep) ?? 0;
  const category = readChoice(boxes.category);
  const fallbackCategory = HW_CATEGORIES.includes(category as (typeof HW_CATEGORIES)[number])
    ? category!
    : 'AI Hardware Industry';
  return {
    relevant: relevanceP >= 0.5,
    keep: keepP >= 0.5,
    category: fallbackCategory,
    relevanceP,
  };
}

// ── Score evaluation (Analyst scores migration) ───────────────────

/** jev `score` boxes may expose the numeric value or a tier label — try both */
function readScoreBox(box: unknown): number | null {
  if (!box || typeof box !== 'object') return null;
  const obj = box as Record<string, unknown>;
  for (const key of ['score', 'value', 'rating', 'points']) {
    if (typeof obj[key] === 'number' && Number.isFinite(obj[key] as number)) {
      return Math.min(100, Math.max(0, obj[key] as number));
    }
  }
  for (const key of ['tier', 'score_tier', 'choice', 'label', 'value']) {
    const tier = obj[key];
    if (typeof tier === 'string') {
      // Tier labels look like '80-94', '95-100', '0-49'
      const range = tier.match(/(\d+)\s*-\s*(\d+)/);
      if (range) {
        const lo = parseInt(range[1], 10);
        const hi = parseInt(range[2], 10);
        if (Number.isFinite(lo) && Number.isFinite(hi)) return Math.round((lo + hi) / 2);
      }
      const single = parseInt(tier, 10);
      if (Number.isFinite(single)) return Math.min(100, Math.max(0, single));
    }
  }
  // Last resort: a probability in [0,1] scaled up
  const probability = readNoul(box as JevAnswerBox);
  return probability != null ? Math.round(probability * 100) : null;
}

/**
 * Score kept items 0-100 with the jev `score` type (tiered ordered scoring):
 * 热度 30% (source engagement) + 质量 40% (original depth) + 相关度 30%
 * (AI-hardware fit). Replaces the Analyst LLM's scores output. Returns a
 * Map of id → score, or null when jev is unavailable.
 */
export async function scoreItemsWithJev(
  env: Record<string, string | undefined>,
  items: TrendSourceItem[],
  signal?: AbortSignal,
): Promise<Map<string, number> | null> {
  if (!items.length) return new Map();

  const questions: Record<string, JevQuestion> = {
    overall_score: {
      type: 'score',
      instructions: '为该 AI 硬件资讯打综合推荐分档。依据：源站互动热度（engagement）占30%，内容质量（首发深度/技术突破 > 二手转述 > 营销软文）占40%，与 AI 硬件核心话题（机器人/芯片/穿戴/端侧/智能设备）的贴合度占30%。',
      criteria: {
        '95-100': '划时代事件（如颠覆性硬件平台发布）',
        '80-94': '重大进展/深度首发（新芯片发布、机器人量产、重量级新品）',
        '65-79': '值得关注的行业动态/技术博客',
        '50-64': '一般性资讯/二手转述',
        '0-49': '边缘相关内容',
      },
    },
  };

  const scores = new Map<string, number>();

  for (let i = 0; i < items.length; i += JEV_CHUNK_SIZE) {
    const chunk = items.slice(i, i + JEV_CHUNK_SIZE);
    const answers = await callJev(env, toCompactState(chunk), questions, signal);
    if (!answers) return null;

    let perItemBoxes: Array<unknown>;
    if (Array.isArray(answers)) {
      if (answers.length !== chunk.length) return null;
      perItemBoxes = answers.map(box => (box as Record<string, unknown> | undefined)?.overall_score);
    } else {
      const sc = (answers as Record<string, unknown>).overall_score;
      if (!Array.isArray(sc) || sc.length !== chunk.length) {
        console.warn('[jev] unexpected score answer shape, falling back');
        return null;
      }
      perItemBoxes = sc;
    }

    chunk.forEach((item, j) => {
      const score = readScoreBox(perItemBoxes[j]);
      if (score != null) scores.set(item.id, score);
    });
  }

  return scores.size ? scores : null;
}

export { callJev };
