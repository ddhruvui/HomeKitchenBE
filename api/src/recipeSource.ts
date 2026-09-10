// Where a recipe draft can come from other than the model's memory: a page's own structured data, or a YouTube video.
// Nothing here talks to a model — this is fetching and parsing, so it is tested without the network being clever.
import { promises as dns } from 'dns';
import { isIP } from 'net';

export type SourceKind = 'web' | 'video';
/** What a page told us about itself. Strings are the source's own words; the model turns them into our units. */
export interface ParsedRecipe { title?: string; servings?: number; ingredients: string[]; steps: string[]; }

const YOUTUBE_HOSTS = ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be'];
export const kindOf = (url: URL): SourceKind => (YOUTUBE_HOSTS.includes(url.hostname.toLowerCase()) ? 'video' : 'web');

/** A private address is one a browser on your sofa could not reach; the API is open, so it must not become a probe for your LAN. */
export function isPrivateAddress(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return true;
  if (isIP(h) === 6) return h === '::1' || h === '::' || /^(fc|fd|fe80)/.test(h) || /^::ffff:/.test(h);
  if (isIP(h) !== 4) return false;
  const [a, b] = h.split('.').map(Number);
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
}

/** Parse and vet a user-supplied link before anything fetches it. Throws a message meant for a person. */
export async function checkUrl(raw: string): Promise<URL> {
  let url: URL;
  try { url = new URL(raw.trim()); } catch { throw new Error('that does not look like a link'); }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('only http and https links can be read');
  if (isPrivateAddress(url.hostname)) throw new Error('that link points inside a private network');
  try {
    const { address } = await dns.lookup(url.hostname);
    if (isPrivateAddress(address)) throw new Error('that link points inside a private network');
  } catch (e) {
    if (e instanceof Error && e.message.includes('private network')) throw e;
    throw new Error(`could not find ${url.hostname}`);
  }
  return url;
}

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const MAX_BYTES = 4_000_000;

/** Fetch a page as a browser would. Sites that block robots answer 403 here, which is a normal outcome, not a crash. */
export async function fetchPage(url: URL, timeoutMs = 12_000): Promise<string> {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), redirect: 'follow', headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml', 'accept-language': 'en-US,en;q=0.9' } });
  if (!res.ok) throw new Error(res.status === 403 || res.status === 401 ? `${url.hostname} does not allow us to read the page` : `${url.hostname} answered ${res.status}`);
  return (await res.text()).slice(0, MAX_BYTES);
}

const text = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '')
  .replace(/<[^>]*>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d))).replace(/\s+/g, ' ').trim();

/** recipeInstructions is the messiest field in the wild: a string, a list of strings, HowToStep objects, or sections of them. */
function stepsFrom(v: unknown, depth = 0): string[] {
  if (depth > 3) return [];
  if (typeof v === 'string') return v.split(/\n+|(?<=\.)\s{2,}/).map(text).filter(Boolean);
  if (Array.isArray(v)) return v.flatMap((x) => stepsFrom(x, depth + 1));
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (o.itemListElement) return stepsFrom(o.itemListElement, depth + 1);
    const t = text(o.text ?? o.name);
    return t ? [t] : [];
  }
  return [];
}
function servingsFrom(v: unknown): number | undefined {
  const first = Array.isArray(v) ? v.find((x) => typeof x === 'string' || typeof x === 'number') : v;
  const n = Number(String(first ?? '').match(/\d+(\.\d+)?/)?.[0]);
  return Number.isFinite(n) && n > 0 && n <= 100 ? n : undefined;
}
const isRecipeNode = (o: Record<string, unknown>) => {
  const t = o['@type'];
  return t === 'Recipe' || (Array.isArray(t) && t.includes('Recipe'));
};

/** Pull the schema.org/Recipe out of a page's JSON-LD. Null means the page did not publish one — that is common, not an error. */
export function parseJsonLdRecipe(html: string): ParsedRecipe | null {
  const blocks = html.match(/<script[^>]*type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi) ?? [];
  let found: Record<string, unknown> | null = null;
  const walk = (v: unknown, depth = 0) => {
    if (found || depth > 6) return;
    if (Array.isArray(v)) return v.forEach((x) => walk(x, depth + 1));
    if (!v || typeof v !== 'object') return;
    const o = v as Record<string, unknown>;
    if (isRecipeNode(o)) { found = o; return; }
    for (const x of Object.values(o)) walk(x, depth + 1);
  };
  for (const b of blocks) {
    const body = b.replace(/^<script[^>]*>/i, '').replace(/<\/script>$/i, '').trim();
    try { walk(JSON.parse(body)); } catch { /* a malformed block is not the page's only block */ }
    if (found) break;
  }
  if (!found) return null;
  const node: Record<string, unknown> = found;
  const ingredients = (Array.isArray(node.recipeIngredient) ? node.recipeIngredient : []).map(text).filter(Boolean).slice(0, 60);
  if (ingredients.length === 0) return null;
  return { title: text(node.name) || undefined, servings: servingsFrom(node.recipeYield), ingredients, steps: stepsFrom(node.recipeInstructions).slice(0, 40) };
}
