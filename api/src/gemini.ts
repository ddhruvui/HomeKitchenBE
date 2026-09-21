import { z } from 'zod';
import { GoogleGenAI, type GenerateContentConfig, type ThinkingLevel } from '@google/genai';
import { config } from './env';

export interface BridgeRequest { id: string; name: string; countUnit?: 'each' | 'bunch'; wantCup: boolean; wantCount: boolean; }
export interface BridgeEstimate { id: string; ozPerCup?: number; ozPerCount?: number; rationale: string; }

export interface GenerateOpts { timeoutMs?: number }
/** The one function that knows a model exists. Injected so tests never call the network. */
export type Generate = (prompt: string, opts?: GenerateOpts) => Promise<string>;

/** An error whose message is already a sentence for the person reading it, so callers pass it through instead of wrapping it. */
export class ModelError extends Error {
  constructor(message: string) { super(message); this.name = 'ModelError'; }
}
const statusOf = (e: unknown) => (e as { status?: number })?.status;
const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));
/** Not every model accepts every thinking level (3.8-flash rejects MINIMAL), so a refusal drops the setting rather than the call. */
const rejectsThinking = (e: unknown) => statusOf(e) === 400 && /thinking/i.test(messageOf(e));

export function makeGeminiGenerate(apiKey = config.geminiKey, model = config.geminiModel): Generate {
  if (!apiKey) throw new Error('GEMINI_API_KEY is not set');
  const ai = new GoogleGenAI({ apiKey });
  // 503 means the model is momentarily oversubscribed and a short wait fixes it. 429 does not: the free tier hands out
  // 5-10 requests a minute and tells us to come back in ~17s, which is longer than anyone is willing to watch a spinner.
  return async (prompt, opts = {}) => {
    let thinking = config.geminiThinking;
    let lastErr: unknown = new Error('timed out');
    const budget = opts.timeoutMs ?? config.geminiTimeoutMs;
    const deadline = Date.now() + budget;                      // one budget for the whole call, retries included
    for (let attempt = 0; attempt < 3 && Date.now() < deadline; attempt++) {
      try {
        const cfg: GenerateContentConfig = { responseMimeType: 'application/json', temperature: 0.1, abortSignal: AbortSignal.timeout(deadline - Date.now()) };
        if (thinking) cfg.thinkingConfig = { thinkingLevel: thinking as ThinkingLevel };
        const res = await ai.models.generateContent({ model, contents: prompt, config: cfg });
        return res.text ?? '';
      } catch (e) {
        lastErr = e;
        if (rejectsThinking(e)) { thinking = ''; continue; }
        if (statusOf(e) !== 503) break;
        await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      }
    }
    const msg = messageOf(lastErr);
    if (statusOf(lastErr) === 429 || /RESOURCE_EXHAUSTED|quota/i.test(msg)) {
      const wait = msg.match(/retry in ([0-9.]+)s/i)?.[1];
      throw new ModelError(`The free Gemini quota for ${model} is used up for the minute — try again${wait ? ` in ${Math.ceil(Number(wait))}s` : ' shortly'}.`);
    }
    if (/aborted|AbortError|timed? ?out/i.test(msg)) throw new ModelError(`${model} did not answer within ${Math.round(budget / 1000)}s — try again.`);
    if (/UNAVAILABLE|high demand|503/.test(msg)) throw new ModelError('The model is busy right now — try again in a moment.');
    throw new Error(msg);
  };
}

export function buildPrompt(reqs: BridgeRequest[]): string {
  const lines = reqs.map((r) => {
    const wants: string[] = [];
    if (r.wantCup) wants.push('ozPerCup: weight in ounces of ONE US cup of this ingredient as it is typically measured in a recipe (chopped/diced for produce, as-is for liquids and powders)');
    if (r.wantCount) wants.push(`ozPerCount: weight in ounces of ONE ${r.countUnit ?? 'each'} (a single typical ${r.countUnit === 'bunch' ? 'grocery-store bunch' : 'medium item'})`);
    return `- id "${r.id}", ingredient "${r.name}": provide ${wants.join('; ')}`;
  });
  return [
    'You estimate ingredient densities for a home-cooking shopping list. US customary units, avoirdupois ounces.',
    'Return ONLY a JSON array. Each element: {"id": string, "ozPerCup"?: number, "ozPerCount"?: number, "rationale": string (one short sentence)}.',
    'Omit a field rather than guessing wildly. Numbers are plain decimals, no units in the value.',
    'Ingredients:', ...lines,
  ].join('\n');
}

const Raw = z.array(z.object({ id: z.string(), ozPerCup: z.number().optional(), ozPerCount: z.number().optional(), rationale: z.string().optional() }));

/** Plausibility fence: a cup of anything edible weighs 0.1–20 oz; a single item or bunch 0.05–200 oz. */
export function sanitize(e: { id: string; ozPerCup?: number; ozPerCount?: number; rationale?: string }): BridgeEstimate | null {
  const out: BridgeEstimate = { id: e.id, rationale: (e.rationale ?? '').slice(0, 200) };
  if (typeof e.ozPerCup === 'number' && Number.isFinite(e.ozPerCup) && e.ozPerCup >= 0.1 && e.ozPerCup <= 20) out.ozPerCup = Math.round(e.ozPerCup * 100) / 100;
  if (typeof e.ozPerCount === 'number' && Number.isFinite(e.ozPerCount) && e.ozPerCount >= 0.05 && e.ozPerCount <= 200) out.ozPerCount = Math.round(e.ozPerCount * 100) / 100;
  return out.ozPerCup === undefined && out.ozPerCount === undefined ? null : out;
}

/** Scan out the first complete JSON value, brace by brace. A greedy regex fails the case we actually hit in the wild:
 *  a valid object followed by a second one, where "first { to last }" spans both and parses as neither. */
function firstJsonValue(text: string, open: '{' | '['): string | null {
  const close = open === '{' ? '}' : ']';
  const start = text.indexOf(open);
  if (start < 0) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (esc) { esc = false; continue; }
    if (inStr) { if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === open) depth++;
    else if (c === close && --depth === 0) return text.slice(start, i + 1);
  }
  return null;
}
function unfence(text: string): string {
  return text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
}
function extractJson(text: string): unknown {
  const t = unfence(text);
  try { return JSON.parse(t); } catch { /* the model sometimes adds a word, or a second value, after the first */ }
  const m = firstJsonValue(t, '[');
  if (!m) throw new Error('model returned no JSON array');
  return JSON.parse(m);
}

/** §3 steps 2–3: one call for the whole batch, then the sanitizer. Nothing is written here; the caller confirms. */
export async function estimateBridges(reqs: BridgeRequest[], generate: Generate): Promise<BridgeEstimate[]> {
  if (reqs.length === 0) return [];
  const parsed = Raw.safeParse(extractJson(await generate(buildPrompt(reqs))));
  if (!parsed.success) throw new Error('model response did not match the expected shape');
  const wanted = new Set(reqs.map((r) => r.id));
  return parsed.data.filter((e) => wanted.has(e.id)).map(sanitize).filter((e): e is BridgeEstimate => e !== null);
}
