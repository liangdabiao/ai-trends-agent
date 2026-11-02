import { collectTikhub } from './_tikhub.js';
import type { TrendSourceItem } from './_types.js';

export const AI_KEYWORDS = [
  // Hardware domains
  'robot', 'robots', 'robotics', 'humanoid', 'quadruped', 'drone', 'drones', 'uav',
  'actuator', 'servo', 'embodied',
  'chip', 'chips', 'gpu', 'npu', 'asic', 'tpu', 'semiconductor', 'silicon', 'foundry',
  'tsmc', 'nvidia', 'qualcomm', 'broadcom', 'amd', 'intel',
  'glasses', 'wearable', 'headset', 'ar', 'vr', 'xr', 'smartwatch', 'earbuds', 'vision pro',
  'edge ai', 'on-device', 'ai pc', 'ai phone', 'smartphone', 'autonomous driving',
  'robotaxi', 'self-driving', 'ev', 'lidar',
  'smart home', 'iot', 'gadget', 'device', 'hardware',
  // Chinese
  '机器人', '人形', '具身智能', '机器狗', '无人机', '执行器', '伺服',
  '芯片', '半导体', '算力', '光刻', '制程', '台积电', '英伟达', '高通',
  '眼镜', '头显', '穿戴', '手表', '耳机', '元宇宙',
  '端侧', '智驾', '自动驾驶', '智能驾驶', '车机', '激光雷达',
  '智能家居', '智能硬件', '硬件', '玩具', 'IoT',
];

const CATEGORY_KEYWORDS: Record<string, string[]> = {
  'Robotics': ['robot', 'robotics', 'humanoid', 'quadruped', 'drone', 'uav', 'actuator', 'embodied', '机器人', '人形', '具身智能', '机器狗', '无人机', '执行器'],
  'AI Chips': ['chip', 'gpu', 'npu', 'asic', 'tpu', 'semiconductor', 'silicon', 'foundry', 'tsmc', 'nvidia', 'qualcomm', '芯片', '半导体', '算力', '光刻', '制程', '台积电', '英伟达'],
  'Wearables & XR': ['glasses', 'wearable', 'headset', 'ar', 'vr', 'xr', 'smartwatch', 'earbuds', 'vision pro', '眼镜', '头显', '穿戴', '手表', '耳机'],
  'Edge AI': ['edge ai', 'on-device', 'ai pc', 'ai phone', 'smartphone', 'autonomous driving', 'robotaxi', 'self-driving', 'lidar', '端侧', '智驾', '自动驾驶', '智能驾驶', '车机', '激光雷达'],
  'Smart Devices': ['smart home', 'iot', 'gadget', 'smart device', 'toy', '智能家居', 'IoT', '智能硬件', '玩具'],
};

function nowIso(): string {
  return new Date().toISOString();
}

export function cleanText(value: unknown): string {
  return String(value || '')
    .replace(/&#x2F;/g, '/')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/<[^>]+>/g, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isUrlOnly(value: string): boolean {
  const compact = value.trim().toLowerCase();
  return !compact || /^https?:\/\/\S+$/.test(compact);
}

export function buildFallbackAiSummary(item: TrendSourceItem): string {
  const cleanedSummary = cleanText(item.summary);
  if (cleanedSummary && !isUrlOnly(cleanedSummary) && cleanedSummary.length >= 24) {
    return cleanedSummary.slice(0, 220);
  }
  const title = cleanText(item.title) || '该动态';
  const category = item.category || inferCategory(item);
  return `${category} 动态：${title}。`;
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { 'User-Agent': 'EdgeOne-Agent-AI-Trends-Node/1.0' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return await res.json() as T;
}

export function normalizeText(item: TrendSourceItem): string {
  return [item.title, item.summary, item.url].filter(Boolean).join(' ').toLowerCase();
}

export function inferCategory(item: TrendSourceItem): string {
  const text = normalizeText(item);
  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    if (keywords.some(keyword => text.includes(keyword))) return category;
  }
  return 'AI Hardware Industry';
}

export function filterAiItems(items: TrendSourceItem[], keywords: string[] = AI_KEYWORDS): TrendSourceItem[] {
  const activeKeywords = keywords.map(keyword => keyword.toLowerCase());
  const seen = new Set<string>();
  const filtered: TrendSourceItem[] = [];

  for (const item of items) {
    const text = normalizeText(item);
    if (!activeKeywords.some(keyword => text.includes(keyword))) continue;
    const key = String(item.url || item.title || item.id).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const enriched = { ...item, summary: cleanText(item.summary), category: item.category ?? inferCategory(item) };
    filtered.push({ ...enriched, aiSummary: buildFallbackAiSummary(enriched) });
  }

  return filtered;
}

export async function collectHackerNews(limit = 20): Promise<TrendSourceItem[]> {
  try {
    const ids = (await fetchJson<number[]>('https://hacker-news.firebaseio.com/v0/topstories.json')).slice(0, limit);
    const items: Array<TrendSourceItem | null> = await Promise.all(ids.map(async id => {
      try {
        const item = await fetchJson<Record<string, unknown>>(`https://hacker-news.firebaseio.com/v0/item/${id}.json`);
        if (item.type !== 'story') return null;
        const time = typeof item.time === 'number' ? new Date(item.time * 1000).toISOString() : nowIso();
        return {
          id: `hn_${id}`,
          source: 'Hacker News',
          title: String(item.title || 'Untitled'),
          url: String(item.url || `https://news.ycombinator.com/item?id=${id}`),
          score: typeof item.score === 'number' ? item.score : 0,
          publishedAt: time,
          summary: typeof item.text === 'string' ? item.text : '',
        } satisfies TrendSourceItem;
      } catch {
        return null;
      }
    }));
    return items.filter((item): item is TrendSourceItem => Boolean(item));
  } catch {
    return [];
  }
}

export async function collectDevto(limit = 20): Promise<TrendSourceItem[]> {
  try {
    const data = await fetchJson<Record<string, unknown>[]>(`https://dev.to/api/articles?tag=ai&per_page=${limit}`);
    return data.slice(0, limit).map(article => ({
      id: `devto_${String(article.id || article.path || article.url)}`,
      source: 'Dev.to',
      title: String(article.title || 'Untitled'),
      url: String(article.url || 'https://dev.to'),
      score: typeof article.public_reactions_count === 'number' ? article.public_reactions_count : 0,
      publishedAt: typeof article.published_at === 'string' ? article.published_at : nowIso(),
      summary: typeof article.description === 'string' ? article.description : '',
    }));
  } catch {
    return [];
  }
}

// ── Sandbox browser: scrape JS-rendered pages ──

/** Default web sources that require sandbox to fetch */
const DEFAULT_WEB_SOURCES = [
  {
    url: 'https://36kr.com/information/AI/',
    source: '36kr',
    // url: 'https://hellogithub.com/',
    // source: 'GitHub',
    method: 'browser' as const,
    extractScript: `
      JSON.stringify(
        Array.from(document.querySelectorAll('a[href*="/p/"]')).slice(0, 40).map(a => {
          const href = a.getAttribute('href') || '';
          if (!href.match(/\\/p\\/\\d/)) return null;
          const titleEl = a.querySelector('h2, h3, h4, [class*="title"], [class*="Title"]') || a;
          const title = (titleEl.textContent || '').replace(/\\s+/g, ' ').trim();
          if (!title || title.length < 6 || title.length > 100) return null;
          const parent = a.closest('div, article, section') || a.parentElement;
          const descEl = parent?.querySelector('p, [class*="desc"], [class*="summary"], [class*="subtitle"]');
          const summary = descEl ? (descEl.textContent || '').trim().slice(0, 150) : '';
          return { title, url: href, summary };
        }).filter(Boolean).filter((item, i, arr) =>
          arr.findIndex(x => x.url === item.url) === i
        ).slice(0, 20)
      );
    `,
  },
];

/**
 * Collect items from web pages via sandbox capabilities.
 * - method='browser': sandbox.browser.goto + evaluate (for JS-rendered SPAs)
 * - method='curl': sandbox.commands.run('curl ...') (for SSR pages)
 * Returns [] gracefully when sandbox is unavailable.
 */
export async function collectFromWeb(
  sandbox: unknown,
  webSources: typeof DEFAULT_WEB_SOURCES = DEFAULT_WEB_SOURCES,
  limit = 10,
): Promise<TrendSourceItem[]> {
  if (!sandbox || typeof sandbox !== 'object') return [];

  const sbx = sandbox as {
    browser?: {
      goto(url: string, opts?: { waitUntil?: string }): Promise<{ success?: boolean; data?: unknown; error?: string }>;
      evaluate(script: string): Promise<{ success?: boolean; data?: unknown; error?: string }>;
    };
    commands?: {
      run(cmd: string, opts?: Record<string, unknown>): Promise<{ stdout?: string; stderr?: string; exitCode?: number }>;
    };
  };

  const allItems: TrendSourceItem[] = [];

  for (const ws of webSources) {
    try {
      if (ws.method === 'browser') {
        // JS-rendered SPA: use sandbox browser
        if (!sbx.browser || typeof sbx.browser.goto !== 'function') {
          console.warn(`[sandbox-browser] browser not available, skipping ${ws.url}`);
          continue;
        }
        console.log(`[sandbox-browser] navigating to ${ws.url}`);
        const nav = await sbx.browser.goto(ws.url, { waitUntil: 'domcontentloaded' });
        console.log(`[sandbox-browser] navigation result:`, JSON.stringify(nav));
        if (nav?.error) {
          console.warn(`[sandbox-browser] navigation failed for ${ws.url}: ${nav.error}`);
          continue;
        }

        // Debug: dump what the browser actually sees
        const debug = await sbx.browser.evaluate(`
          JSON.stringify({
            title: document.title,
            headings: Array.from(document.querySelectorAll('h1,h2,h3,h4')).slice(0,5).map(h => h.textContent?.trim().slice(0,50)),
            newsLinks: Array.from(document.querySelectorAll('a[href*="/news/"]')).slice(0,5).map(a => ({
              href: a.getAttribute('href'),
              text: a.textContent?.trim().slice(0,50),
              inner: a.innerHTML?.slice(0,100)
            }))
          })
        `);
        console.log(`[sandbox-browser] page debug:`, typeof debug?.data === 'string' ? debug.data : JSON.stringify(debug?.data));

        const result = await sbx.browser.evaluate(ws.extractScript!);
        if (!result?.success || !result?.data) {
          console.warn(`[sandbox-browser] evaluate failed for ${ws.url}: ${result?.error || 'no data'}`);
          continue;
        }
        const rawItems: Array<{ title: string; url: string; score?: number; summary?: string }> = (() => {
          const d = result.data;
          if (typeof d === 'string') { try { return JSON.parse(d); } catch { return []; } }
          return Array.isArray(d) ? d : [];
        })();

        for (let i = 0; i < Math.min(rawItems.length, limit); i++) {
          const raw = rawItems[i];
          if (!raw.title || !raw.url) continue;
          allItems.push({
            id: `web_${Buffer.from(raw.url).toString('base64url').slice(0, 24)}`,
            source: ws.source,
            title: cleanText(raw.title),
            url: raw.url.startsWith('http') ? raw.url : new URL(raw.url, ws.url).href,
            score: raw.score ?? 0, // Web 源无真实互动数据，Agent 会根据内容综合打分
            publishedAt: nowIso(),
            summary: raw.summary || '',
          });
        }
        console.log(`[sandbox-browser] collected ${allItems.length} items from ${ws.source}`);
      }
    } catch (error: any) {
      console.warn(`[sandbox-web] failed for ${ws.url}:`, {
        message: error?.message,
        name: error?.name,
        status: error?.status || error?.statusCode,
        code: error?.code,
        stderr: error?.stderr,
        stack: error?.stack?.split('\n').slice(0, 3).join('\n'),
      });
    }
  }

  return allItems.slice(0, limit);
}

/**
 * Unified collection. Keyword filter is the coarse pre-gate (fast, free);
 * the semantic gate runs later in the pipeline via the jev decision model
 * (see curateWithJev in _model.ts). TikHub sources (X/Reddit/Weibo/YouTube)
 * are enabled via TIKHUB_TOKEN + TIKHUB_SOURCES.
 */
export async function collectSources(
  sources: string[] = ['hackernews', 'devto'],
  limit = 30,
  sandbox?: unknown,
  env?: Record<string, string | undefined>,
  signal?: AbortSignal,
): Promise<TrendSourceItem[]> {
  const batches = await Promise.all([
    sources.includes('hackernews') ? collectHackerNews(40) : Promise.resolve([]),
    sources.includes('devto') ? collectDevto(25) : Promise.resolve([]),
    sources.includes('web') ? collectFromWeb(sandbox ?? null, DEFAULT_WEB_SOURCES, 25) : Promise.resolve([]),
    sources.includes('tikhub') && env ? collectTikhub(env, signal) : Promise.resolve([]),
  ]);

  const [hnItems, devtoItems, webItems, tikhubItems] = batches;
  const raw = [...hnItems, ...devtoItems, ...webItems, ...tikhubItems];

  // Dedup raw candidates (same URL/title may appear in multiple sources)
  const seenKeys = new Set<string>();
  const deduped = raw.filter(item => {
    const key = String(item.url || item.title || item.id).toLowerCase();
    if (seenKeys.has(key)) return false;
    seenKeys.add(key);
    return true;
  });

  // ── Coarse gate: keyword filter ──
  const filtered = filterAiItems(deduped);
  console.log(`[sources] keyword filter kept ${filtered.length}/${deduped.length}`);
  return balanceAcrossSources(filtered, limit);
}

/**
 * Balanced allocation across sources: round-robin one item per non-empty
 * source bucket (HN / DevTo / Web / TikHub feeds) until `limit` is reached,
 * so a single dominant source can't crowd out the others.
 */
function balanceAcrossSources(items: TrendSourceItem[], limit: number): TrendSourceItem[] {
  const isHN = (i: TrendSourceItem) => (i.source || '').toLowerCase().includes('hacker news');
  const isDevto = (i: TrendSourceItem) => (i.source || '').toLowerCase().includes('dev.to');
  const isTikhubFeed = (i: TrendSourceItem) => ['x', 'reddit', 'weibo', 'youtube'].includes((i.source || '').toLowerCase());

  const buckets: TrendSourceItem[][] = [
    items.filter(isHN),
    items.filter(isDevto),
    items.filter(i => !isHN(i) && !isDevto(i) && !isTikhubFeed(i)),
    items.filter(isTikhubFeed),
  ].filter(bucket => bucket.length > 0);

  const selected: TrendSourceItem[] = [];
  let cursor = 0;
  while (selected.length < limit && buckets.some(b => b.length)) {
    const bucket = buckets[cursor % buckets.length];
    cursor++;
    const item = bucket.shift();
    if (item) selected.push(item);
  }
  return selected;
}
