import type { TrendSourceItem } from './_types.js';

// ── TikHub social-data collector (paid, per-request billing) ──────
//
// Adds X/Twitter search, Reddit subreddits, Weibo hot search and YouTube
// search as structured API sources — replacing fragile sandbox browser
// scraping. Token comes from `context.env.TIKHUB_TOKEN` (Makers red line:
// never process.env). All endpoints confirmed against TikHub's OpenAPI
// spec (https://api.tikhub.io/openapi.json, 2026-11):
//   GET /api/v1/twitter/web/fetch_search_timeline?keyword=&search_type=
//   GET /api/v1/reddit/app/fetch_subreddit_feed?subreddit_name=&sort=
//   GET /api/v1/weibo/app/fetch_hot_search?category=realtimehot&page=1&count=
//   GET /api/v1/youtube/web/search_video?search_query=&order_by=this_month
//
// Response payloads are wrapped in TikHub's generic ResponseModel and the
// inner shapes vary per platform/version — extraction is therefore done by
// a defensive deep-walk (field-candidate matching), never by strict paths.

const TIKHUB_BASE = 'https://api.tikhub.io';

// Field candidates for the generic extractor
const TITLE_KEYS = ['title', 'note', 'word', 'text', 'full_text', 'headline', 'name', 'subject', 'description'];
const TEXT_KEYS = ['text', 'full_text', 'summary', 'description', 'excerpt', 'content', 'note', 'reason'];
const URL_KEYS = ['url', 'permalink', 'short_url', 'web_url', 'link', 'share_url', 'target_url'];
const ID_KEYS = ['id_str', 'rest_id', 'videoId', 'video_id', 'id', 'bid', 'mid', 'item_id'];
const SCORE_KEYS = [
  'favorite_count', 'like_count', 'likes', 'digg_count', 'ups', 'upvotes',
  'score', 'raw_hot', 'hot_value', 'num', 'view_count', 'views',
  'reposts_count', 'read_count', 'play_count', 'comment_count',
];

interface ExtractedRaw {
  id: string;
  title: string;
  text: string;
  url: string;
  score: number;
}

function firstString(obj: Record<string, unknown>, keys: string[], exclude?: string): string {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === 'string' && value.trim() && value !== exclude) return value.trim();
  }
  return '';
}

function firstNumber(obj: Record<string, unknown>, keys: string[]): number {
  let best = 0;
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === 'number' && Number.isFinite(value) && value > best) best = value;
    if (typeof value === 'string' && /^[\d.]+$/.test(value) && parseFloat(value) > best) best = parseFloat(value);
  }
  return best;
}

function hashKey(input: string): string {
  return Buffer.from(input).toString('base64url').slice(0, 24);
}

/**
 * Deep-walk any JSON payload and pull out item-like objects (have a title
 * and an id/url). Platform-agnostic — tolerates TikHub wrapper versions.
 */
function extractRawNodes(node: unknown, out: ExtractedRaw[], depth = 0): void {
  if (!node || depth > 12 || out.length > 200) return;
  if (Array.isArray(node)) {
    for (const child of node) extractRawNodes(child, out, depth + 1);
    return;
  }
  if (typeof node !== 'object') return;
  const obj = node as Record<string, unknown>;

  const title = firstString(obj, TITLE_KEYS);
  const id = firstString(obj, ID_KEYS);
  const hasIdOrUrl = id || firstString(obj, URL_KEYS);
  if (title.length >= 4 && title.length <= 300 && hasIdOrUrl) {
    out.push({
      id,
      title,
      text: firstString(obj, TEXT_KEYS, title).slice(0, 400),
      url: firstString(obj, URL_KEYS),
      score: firstNumber(obj, SCORE_KEYS),
    });
  }
  for (const value of Object.values(obj)) {
    if (value && typeof value === 'object') extractRawNodes(value, out, depth + 1);
  }
}

function absolutize(url: string, base: string): string {
  if (!url) return base;
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  return url.startsWith('/') ? `https://${base}${url}` : base;
}

interface TikhubSourceDef {
  name: string;
  prefix: string;
  buildUrl(item: ExtractedRaw): string;
  /** Post-filter: skip noise (e.g. Weibo entertainment hot entries) */
  accept?(item: ExtractedRaw): boolean;
}

const SOURCE_DEFS: Record<string, TikhubSourceDef> = {
  x: {
    name: 'X',
    prefix: 'x',
    buildUrl: item => item.url || `https://x.com/i/web/status/${item.id}`,
  },
  reddit: {
    name: 'Reddit',
    prefix: 'reddit',
    buildUrl: item => absolutize(item.url, 'www.reddit.com'),
  },
  weibo: {
    name: 'Weibo',
    prefix: 'wb',
    // Hot-search entries carry the keyword, not a link — build the search URL
    buildUrl: item => item.url || `https://s.weibo.com/weibo?q=${encodeURIComponent(`#${item.title}#`)}`,
    // Skip clearly non-tech trending topics; jev does semantic filtering later
    accept: item => item.title.length >= 4,
  },
  youtube: {
    name: 'YouTube',
    prefix: 'yt',
    buildUrl: item => item.url || `https://www.youtube.com/watch?v=${item.id}`,
  },
};

async function fetchTikhubApi(
  path: string,
  params: Record<string, string | number | undefined>,
  token: string,
  signal?: AbortSignal,
): Promise<unknown | null> {
  const url = new URL(`${TIKHUB_BASE}${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') url.searchParams.set(key, String(value));
  }
  const timeoutController = new AbortController();
  const timer = setTimeout(() => timeoutController.abort(), 30000);
  const onExternalAbort = () => timeoutController.abort();
  signal?.addEventListener('abort', onExternalAbort);
  try {
    const res = await fetch(url.href, {
      headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' },
      signal: timeoutController.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.warn(`[tikhub] ${path} HTTP ${res.status}: ${body.slice(0, 150)}`);
      return null;
    }
    const data = await res.json().catch(() => null);
    // TikHub wraps payloads: { code, message, data: ... } or { data: { data: ... } }
    return (data as { data?: unknown })?.data ?? data;
  } catch (err: any) {
    if (err?.name === 'AbortError' && signal?.aborted) throw err;
    console.warn(`[tikhub] ${path} failed: ${err?.message || err}`);
    return null;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onExternalAbort);
  }
}

function collectFromPayload(
  payload: unknown,
  def: TikhubSourceDef,
  limit: number,
): TrendSourceItem[] {
  if (!payload) return [];
  const raw: ExtractedRaw[] = [];
  extractRawNodes(payload, raw);

  const seen = new Set<string>();
  const items: TrendSourceItem[] = [];
  for (const node of raw) {
    if (items.length >= limit) break;
    if (def.accept && !def.accept(node)) continue;
    const dedupeKey = (node.url || node.title).toLowerCase();
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    items.push({
      id: `${def.prefix}_${node.id || hashKey(dedupeKey)}`,
      source: def.name,
      title: node.title,
      url: def.buildUrl(node),
      score: node.score,
      publishedAt: new Date().toISOString(),
      summary: node.text,
    });
  }
  return items;
}

export interface CollectTikhubOptions {
  xQuery?: string;
  redditSubs?: string[];
  weiboCount?: number;
  youtubeQuery?: string;
  perSourceLimit?: number;
}

/**
 * Collect candidates from TikHub endpoints. Sources are enabled individually
 * by env: TIKHUB_SOURCES (comma list of x,reddit,weibo,youtube; default
 * 'x,reddit,weibo'). Returns [] when no token is configured — the rest of
 * the pipeline keeps working on the free sources.
 */
export async function collectTikhub(
  env: Record<string, string | undefined>,
  signal?: AbortSignal,
  opts: CollectTikhubOptions = {},
): Promise<TrendSourceItem[]> {
  const token = env.TIKHUB_TOKEN;
  if (!token) return [];

  const enabled = (env.TIKHUB_SOURCES || 'x,reddit,weibo')
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);
  const perSourceLimit = opts.perSourceLimit ?? 20;

  const tasks: Array<Promise<TrendSourceItem[]>> = [];

  if (enabled.includes('x')) {
    const keyword = opts.xQuery || env.TIKHUB_X_QUERY
      || 'AI hardware OR "humanoid robot" OR "AI chip" OR "AI glasses" OR "smart ring" OR "edge AI"';
    tasks.push(
      fetchTikhubApi('/api/v1/twitter/web/fetch_search_timeline', { keyword, search_type: 'Top' }, token, signal)
        .then(payload => collectFromPayload(payload, SOURCE_DEFS.x, perSourceLimit)),
    );
  }
  if (enabled.includes('reddit')) {
    const subs = opts.redditSubs
      || (env.TIKHUB_REDDIT_SUBS || 'robotics,MachineLearning,LocalLLaMA,hardware').split(',').map(s => s.trim()).filter(Boolean);
    for (const sub of subs.slice(0, 3)) {
      tasks.push(
        fetchTikhubApi('/api/v1/reddit/app/fetch_subreddit_feed', { subreddit_name: sub }, token, signal)
          .then(payload => collectFromPayload(payload, SOURCE_DEFS.reddit, Math.ceil(perSourceLimit / 2))),
      );
    }
  }
  if (enabled.includes('weibo')) {
    const count = opts.weiboCount ?? 20;
    tasks.push(
      fetchTikhubApi('/api/v1/weibo/app/fetch_hot_search', { category: 'realtimehot', page: 1, count }, token, signal)
        .then(payload => collectFromPayload(payload, SOURCE_DEFS.weibo, perSourceLimit)),
    );
  }
  if (enabled.includes('youtube')) {
    const query = opts.youtubeQuery || env.TIKHUB_YOUTUBE_QUERY || 'AI hardware robot';
    tasks.push(
      fetchTikhubApi('/api/v1/youtube/web/search_video', { search_query: query, order_by: 'this_month' }, token, signal)
        .then(payload => collectFromPayload(payload, SOURCE_DEFS.youtube, perSourceLimit)),
    );
  }

  const batches = await Promise.allSettled(tasks);
  const all: TrendSourceItem[] = [];
  for (const batch of batches) {
    if (batch.status === 'fulfilled') all.push(...batch.value);
    else console.warn(`[tikhub] batch failed:`, batch.reason);
  }
  const names = all.reduce((acc, i) => { acc[i.source || '?'] = (acc[i.source || '?'] || 0) + 1; return acc; }, {} as Record<string, number>);
  console.log(`[tikhub] collected:`, JSON.stringify(names), `(${all.length} total)`);
  return all;
}
