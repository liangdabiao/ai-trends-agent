import type { TrendSourceItem } from './_types.js';

// ── @makers/jev — Makers System One decision model client ─────────
//
// jev is NOT a chat model: it evaluates a `state` against a set of
// strongly-typed questions (noul / choice / score) and returns structured
// decisions on the dedicated `/v1/systemone` endpoint. Protocol verified
// against the live API (2026-11, jev-1.14.0):
//   • answers come back PER QUESTION for the whole state — an array state
//     is judged as one lump, so batch evaluation is impossible → we call
//     once per item with a small concurrency pool (~0.8s per call).
//   • `choice` criteria: object map { option: description } (works as-is)
//   • `score` criteria: ARRAY of { label, description }; the response
//     carries a continuous index into that array plus a `legend`, e.g.
//     score=1.44 → 44% of the way from tier 1 to tier 2.
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
  /** choice: option id → description; score: array of {label, description} */
  criteria?: Record<string, string> | Array<{ label: string; description: string }>;
}

interface JevAnswerBox {
  type?: string;
  noul?: number;
  choice?: string;
  score?: number;
  confidence?: number;
  legend?: Record<string, { label?: string; description?: string }>;
}

export interface JevItemDecision {
  /** 与 AI 硬件直接相关（noul ≥ 0.5） */
  relevant: boolean;
  /** 质量判断：非招聘/营销/低质量（noul ≥ 0.5） */
  keep: boolean;
  /** jev 判定的子领域 */
  category: string;
  /** AI 硬件相关概率（0~1），用于日志；-1 表示调用失败（保守保留） */
  relevanceP: number;
}

/** Sentinel for a failed per-item jev call — keep the item rather than drop it */
const FAILED_DECISION: JevItemDecision = {
  relevant: true,
  keep: true,
  category: 'AI Hardware Industry',
  relevanceP: -1,
};

function resolveJevEndpoint(env: Record<string, string | undefined>): { url: string; apiKey: string } | null {
  const apiKey = env.LLM_API_KEY || env.AI_GATEWAY_API_KEY || env.OPENAI_API_KEY;
  if (!apiKey) return null;
  const baseUrl = (env.LLM_BASE_URL || env.AI_GATEWAY_BASE_URL || 'https://ai-gateway.edgeone.link').replace(/\/+$/, '');
  const root = baseUrl.replace(/\/v1$/, '');
  return { url: `${root}/v1/systemone`, apiKey };
}

/**
 * One jev call for a single state. Returns the per-question answer boxes or
 * null on failure (missing key / HTTP error / timeout / bad shape) — callers
 * degrade gracefully to keyword/heuristic fallbacks.
 */
async function callJev(
  env: Record<string, string | undefined>,
  state: unknown,
  questions: Record<string, JevQuestion>,
  signal?: AbortSignal,
  timeoutMs = 30000,
): Promise<Record<string, JevAnswerBox> | null> {
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
    const data = await res.json().catch(() => null) as { answers?: Record<string, JevAnswerBox> } | null;
    if (!data?.answers || typeof data.answers !== 'object') {
      console.warn('[jev] unexpected response shape (no answers object)');
      return null;
    }
    return data.answers;
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
  const value = box?.noul;
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readChoice(box: JevAnswerBox | undefined): string | null {
  const value = box?.choice;
  return typeof value === 'string' && value ? value : null;
}

/** Concurrency-limited mapper (small pool — jev is fast, ~0.8s per call) */
async function mapWithConcurrency<T, R>(
  input: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
  signal?: AbortSignal,
): Promise<R[]> {
  const results = new Array<R>(input.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, input.length) }, async () => {
    while (cursor < input.length) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      const index = cursor++;
      results[index] = await mapper(input[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

function toCompactState(item: TrendSourceItem) {
  return {
    title: item.title,
    summary: (item.summary || '').slice(0, 200),
    source: item.source || '',
    engagement: item.score ?? 0,
  };
}

const CURATION_QUESTIONS: Record<string, JevQuestion> = {
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

/**
 * Evaluate candidate items with jev: AI-hardware relevance, quality
 * (keep/drop) and category assignment — one call per item, 8-way
 * concurrent. Returns a Map keyed by item id, or null when jev is
 * unavailable — callers must fall back.
 */
export async function evaluateItemsWithJev(
  env: Record<string, string | undefined>,
  items: TrendSourceItem[],
  signal?: AbortSignal,
): Promise<Map<string, JevItemDecision> | null> {
  if (!items.length) return new Map();

  const decisions = await mapWithConcurrency(items, 8, async item => {
    const answers = await callJev(env, toCompactState(item), CURATION_QUESTIONS, signal);
    if (!answers) return FAILED_DECISION; // quota/network failure — conservative keep
    const relevanceP = readNoul(answers.is_ai_hardware) ?? 0;
    const keepP = readNoul(answers.should_keep) ?? 0;
    const category = readChoice(answers.category);
    return {
      relevant: relevanceP >= 0.5,
      keep: keepP >= 0.5,
      category: HW_CATEGORIES.includes(category as (typeof HW_CATEGORIES)[number]) ? category! : 'AI Hardware Industry',
      relevanceP,
    } satisfies JevItemDecision;
  }, signal).catch(err => {
    if (signal?.aborted || err?.name === 'AbortError') throw err;
    console.warn(`[jev] evaluation aborted: ${err?.message || err}`);
    return null;
  });

  if (!decisions) return null;
  const map = new Map<string, JevItemDecision>();
  items.forEach((item, index) => map.set(item.id, decisions[index]));
  const failedCount = decisions.filter(d => d.relevanceP < 0).length;
  if (failedCount) {
    console.warn(`[jev] ${failedCount}/${items.length} calls failed — those items kept by default (check quota/rate limits)`);
  }
  return map;
}

// ── Score evaluation (Analyst scores migration) ───────────────────

const SCORE_TIERS: Array<{ label: string; description: string; midpoint: number }> = [
  { label: '95-100', description: '划时代事件（颠覆性硬件平台发布）', midpoint: 97.5 },
  { label: '80-94', description: '重大进展/深度首发（新芯片、机器人量产、重量级新品）', midpoint: 87 },
  { label: '65-79', description: '值得关注的行业动态/技术博客', midpoint: 72 },
  { label: '50-64', description: '一般性资讯/二手转述', midpoint: 57 },
  { label: '0-49', description: '边缘相关内容', midpoint: 24.5 },
];

/**
 * Map jev's continuous tier-index score (e.g. 1.44 = 44% from tier 1 to
 * tier 2) to a 0-100 value by interpolating between tier midpoints.
 */
function tierIndexToScore(scoreIndex: number): number {
  const lastIndex = SCORE_TIERS.length - 1;
  const clamped = Math.min(lastIndex, Math.max(0, scoreIndex));
  const lower = Math.floor(clamped);
  const upper = Math.min(lastIndex, lower + 1);
  const frac = clamped - lower;
  const value = SCORE_TIERS[lower].midpoint + frac * (SCORE_TIERS[upper].midpoint - SCORE_TIERS[lower].midpoint);
  return Math.round(value);
}

/**
 * Score items 0-100 with the jev `score` type (tiered ordered scoring):
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
      criteria: SCORE_TIERS.map(({ label, description }) => ({ label, description })),
    },
  };

  const scores = await mapWithConcurrency(items, 8, async item => {
    const answers = await callJev(env, toCompactState(item), questions, signal);
    const raw = answers?.overall_score?.score;
    return typeof raw === 'number' && Number.isFinite(raw) ? tierIndexToScore(raw) : null;
  }, signal).catch(err => {
    if (signal?.aborted || err?.name === 'AbortError') throw err;
    console.warn(`[jev] scoring aborted: ${err?.message || err}`);
    return null;
  });

  if (!scores) return null;
  const map = new Map<string, number>();
  items.forEach((item, index) => {
    if (scores[index] != null) map.set(item.id, scores[index]!);
  });
  return map.size ? map : null;
}
