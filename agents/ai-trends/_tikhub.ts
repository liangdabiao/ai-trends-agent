import type { TrendSourceItem } from './_types.js';

// ── TikHub social-data collector (paid, per-request billing) ──────
//
// Adds X/Twitter search, Reddit subreddits, Weibo hot search and YouTube
// search as structured API sources — replacing fragile sandbox browser
// scraping. Token comes from `context.env.TIKHUB_TOKEN` (Makers red line:
// never process.env).
//
// Endpoints confirmed against TikHub's OpenAPI spec
// (https://api.tikhub.io/openapi.json) and validated against live payloads
// (2026-11):
//   GET /api/v1/twitter/web/fetch_search_timeline?keyword=&search_type=
//     → data.timeline[] with { tweet_id, text, favorites, views, screen_name }
//   GET /api/v1/reddit/app/fetch_subreddit_feed?subreddit_name=
//     → GraphQL-style cells: TitleCell / ActionCell siblings joined by a
//       base64 id that decodes to "TitleCell-t3_<post_id>"
//   GET /api/v1/weibo/web_v2/fetch_hot_search
//     → data.realtime[] with { word, note, num, realpos }
//   GET /api/v1/youtube/web/search_video?search_query=&order_by=this_month
//     → data.videos[] with { video_id, title, number_of_views }
//
// Each platform gets a dedicated mapper (validated against real payloads);
// a generic deep-walk extractor stays as fallback for unknown shapes.

const TIKHUB_BASE = 'https://api.tikhub.io';

function hashKey(input: string): string {
  return Buffer.from(input).toString('base64url').slice(0, 24);
}

/** Collect every object node in a JSON payload (bounded). */
function findDicts(node: unknown, out: Array<Record<string, unknown>>, depth = 0): void {
  if (out.length > 800 || depth > 14 || !node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const child of node) findDicts(child, out, depth + 1);
    return;
  }
  out.push(node as Record<string, unknown>);
  for (const value of Object.values(node)) {
    if (value && typeof value === 'object') findDicts(value, out, depth + 1);
  }
}

function asNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && /^[\d,]+$/.test(value.replace(/\s/g, ''))) {
    return parseFloat(value.replace(/,/g, ''));
  }
  return 0;
}

function pushItem(
  items: TrendSourceItem[],
  seen: Set<string>,
  item: TrendSourceItem,
  limit: number,
): void {
  if (items.length >= limit) return;
  const key = item.url.toLowerCase();
  if (seen.has(key)) return;
  seen.add(key);
  items.push(item);
}

// ── X / Twitter mapper ────────────────────────────────────────────

function mapX(payload: unknown, limit: number): TrendSourceItem[] {
  const nodes: Array<Record<string, unknown>> = [];
  findDicts(payload, nodes);
  const items: TrendSourceItem[] = [];
  const seen = new Set<string>();
  for (const node of nodes) {
    const tweetId = node.tweet_id;
    const text = typeof node.text === 'string' ? node.text.trim() : '';
    if (typeof tweetId !== 'string' || !tweetId || text.length < 10) continue;
    const screenName = typeof node.screen_name === 'string' ? node.screen_name.replace(/^@/, '') : 'i';
    const favorites = asNumber(node.favorites);
    const views = asNumber(node.views);
    pushItem(items, seen, {
      id: `x_${tweetId}`,
      source: 'X',
      title: text.slice(0, 200),
      url: `https://x.com/${screenName}/status/${tweetId}`,
      score: favorites || Math.round(views / 100), // views are huge — scale to like-comparable
      publishedAt: new Date().toISOString(),
      summary: '',
    }, limit);
  }
  return items;
}

// ── Reddit mapper (base64-cell merge) ─────────────────────────────

/**
 * Reddit app API returns GraphQL-style cells where the post title
 * (TitleCell) and its engagement (ActionCell) are sibling objects. Their
 * base64 ids decode to "TitleCell-t3_<post_id>" / "ActionCell-t3_<post_id>"
 * (comment cells carry an extra "-<uuid>" suffix) — join cells on the
 * decoded post id.
 */
function mapReddit(payload: unknown, limit: number): TrendSourceItem[] {
  const nodes: Array<Record<string, unknown>> = [];
  findDicts(payload, nodes);

  interface PostSlot { title?: string; score?: number; comments?: number }
  const posts = new Map<string, PostSlot>();
  for (const node of nodes) {
    const rawId = node.id;
    if (typeof rawId !== 'string' || rawId.length < 8) continue;
    let decoded: string;
    try {
      decoded = Buffer.from(rawId, 'base64').toString('utf-8');
    } catch {
      continue;
    }
    const match = decoded.match(/-t3_([A-Za-z0-9]+)/);
    if (!match) continue;
    const postId = match[1];
    const slot = posts.get(postId) ?? {};
    const title = typeof node.title === 'string' ? node.title.trim() : '';
    if (title && (!slot.title || title.length > slot.title.length)) slot.title = title;
    const score = asNumber(node.score);
    if (score > (slot.score ?? 0)) slot.score = score;
    const comments = asNumber(node.commentCount);
    if (comments > (slot.comments ?? 0)) slot.comments = comments;
    posts.set(postId, slot);
  }

  const items: TrendSourceItem[] = [];
  const seen = new Set<string>();
  for (const [postId, slot] of posts) {
    if (!slot.title) continue;
    pushItem(items, seen, {
      id: `reddit_${postId}`,
      source: 'Reddit',
      title: slot.title.slice(0, 200),
      url: `https://www.reddit.com/comments/${postId}`,
      score: slot.score ?? 0,
      publishedAt: new Date().toISOString(),
      summary: slot.comments != null ? `${slot.comments} comments` : '',
    }, limit);
  }
  return items;
}

// ── Weibo hot search mapper (web_v2) ──────────────────────────────

function mapWeibo(payload: unknown, limit: number): TrendSourceItem[] {
  const nodes: Array<Record<string, unknown>> = [];
  findDicts(payload, nodes);
  const items: TrendSourceItem[] = [];
  const seen = new Set<string>();
  for (const node of nodes) {
    const word = typeof node.word === 'string' ? node.word.trim() : '';
    if (word.length < 4) continue;
    const num = asNumber(node.num);
    pushItem(items, seen, {
      id: `wb_${hashKey(word)}`,
      source: 'Weibo',
      title: word,
      url: `https://s.weibo.com/weibo?q=${encodeURIComponent(`#${word}#`)}`,
      score: num,
      publishedAt: new Date().toISOString(),
      summary: typeof node.note === 'string' ? node.note : '',
    }, limit);
  }
  return items;
}

// ── YouTube mapper ────────────────────────────────────────────────

function mapYouTube(payload: unknown, limit: number): TrendSourceItem[] {
  const nodes: Array<Record<string, unknown>> = [];
  findDicts(payload, nodes);
  const items: TrendSourceItem[] = [];
  const seen = new Set<string>();
  for (const node of nodes) {
    const videoId = node.video_id ?? node.videoId;
    const title = typeof node.title === 'string' ? node.title.trim() : '';
    if (typeof videoId !== 'string' || !videoId || title.length < 5) continue;
    const views = asNumber(node.number_of_views ?? node.viewCount);
    pushItem(items, seen, {
      id: `yt_${videoId}`,
      source: 'YouTube',
      title: title.slice(0, 200),
      url: `https://www.youtube.com/watch?v=${videoId}`,
      score: views,
      publishedAt: new Date().toISOString(),
      summary: typeof node.description === 'string' ? node.description.slice(0, 200) : '',
    }, limit);
  }
  return items;
}

// ── API plumbing ──────────────────────────────────────────────────

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
    // TikHub wraps payloads: { code, message, data: ... }
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

  const tasks: Array<{ name: string; run: Promise<TrendSourceItem[]> }> = [];

  if (enabled.includes('x')) {
    const keyword = opts.xQuery || env.TIKHUB_X_QUERY
      || 'AI hardware OR "humanoid robot" OR "AI chip" OR "AI glasses" OR "smart ring" OR "edge AI"';
    tasks.push({
      name: 'X',
      run: fetchTikhubApi('/api/v1/twitter/web/fetch_search_timeline', { keyword, search_type: 'Top' }, token, signal)
        .then(payload => mapX(payload, perSourceLimit)),
    });
  }
  if (enabled.includes('reddit')) {
    const subs = opts.redditSubs
      || (env.TIKHUB_REDDIT_SUBS || 'robotics,MachineLearning,LocalLLaMA,hardware').split(',').map(s => s.trim()).filter(Boolean);
    for (const sub of subs.slice(0, 3)) {
      tasks.push({
        name: `Reddit(${sub})`,
        run: fetchTikhubApi('/api/v1/reddit/app/fetch_subreddit_feed', { subreddit_name: sub }, token, signal)
          .then(payload => mapReddit(payload, Math.ceil(perSourceLimit / 2))),
      });
    }
  }
  if (enabled.includes('weibo')) {
    const count = opts.weiboCount ?? 20;
    tasks.push({
      name: 'Weibo',
      run: fetchTikhubApi('/api/v1/weibo/web_v2/fetch_hot_search', {}, token, signal)
        .then(payload => mapWeibo(payload, perSourceLimit)),
    });
  }
  if (enabled.includes('youtube')) {
    const query = opts.youtubeQuery || env.TIKHUB_YOUTUBE_QUERY || 'AI hardware robot';
    tasks.push({
      name: 'YouTube',
      run: fetchTikhubApi('/api/v1/youtube/web/search_video', { search_query: query, order_by: 'this_month' }, token, signal)
        .then(payload => mapYouTube(payload, perSourceLimit)),
    });
  }

  const results = await Promise.allSettled(tasks.map(t => t.run));
  const all: TrendSourceItem[] = [];
  results.forEach((result, index) => {
    const name = tasks[index].name;
    if (result.status === 'fulfilled') {
      console.log(`[tikhub] ${name}: ${result.value.length} items`);
      all.push(...result.value);
    } else {
      console.warn(`[tikhub] ${name} failed:`, result.reason);
    }
  });
  console.log(`[tikhub] collected ${all.length} items total`);
  return all;
}
