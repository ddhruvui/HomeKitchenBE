import { z } from 'zod';
import { GoogleGenAI, type GenerateContentConfig, type ThinkingLevel } from '@google/genai';
import { config } from './env';
import { ALL_UNITS } from '@home-kitchen/shared';

export interface BridgeRequest { id: string; name: string; countUnit?: 'each' | 'bunch'; wantCup: boolean; wantCount: boolean; }
export interface BridgeEstimate { id: string; ozPerCup?: number; ozPerCount?: number; rationale: string; }

/** One side of a conversation. The model's own turns come back from the browser, so a chat needs no server state. */
export interface ChatTurn { role: 'user' | 'model'; text: string }
/** `text` asks for prose rather than JSON; `history` and `system` are what make a call a conversation rather than a question. */
export interface GenerateOpts { timeoutMs?: number; history?: ChatTurn[]; system?: string; text?: boolean }
/** The one function that knows a model exists. Injected so tests never call the network. */
export type Generate = (prompt: string, opts?: GenerateOpts) => Promise<string>;

/** An error whose message is already a sentence for the person reading it, so callers pass it through instead of wrapping it. */
export class ModelError extends Error {
  constructor(message: string) { super(message); this.name = 'ModelError'; }
}
/** A lone prompt goes as a string; a conversation goes as the turns so far plus this one. */
function asContents(prompt: string, history?: ChatTurn[]) {
  if (!history?.length) return prompt;
  return [...history.map((t) => ({ role: t.role, parts: [{ text: t.text }] })), { role: 'user', parts: [{ text: prompt }] }];
}
const statusOf = (e: unknown) => (e as { status?: number })?.status;
const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));
/** Not every model accepts every thinking level (3.8-flash rejects MINIMAL), so a refusal drops the setting rather than the call. */
const rejectsThinking = (e: unknown) => statusOf(e) === 400 && /thinking/i.test(messageOf(e));

/** Which bucket ran out, and how many it holds. The free tier caps per day as well as per minute, and the two need different advice. */
function quotaViolation(e: unknown): { perDay: boolean; limit?: string } | null {
  const details = (e as { details?: unknown })?.details ?? (e as { error?: { details?: unknown } })?.error?.details;
  const list = Array.isArray(details) ? details : [];
  for (const d of list as Array<{ violations?: Array<{ quotaId?: string; quotaValue?: string }> }>) {
    for (const v of d.violations ?? []) {
      if (v.quotaId) return { perDay: /PerDay/i.test(v.quotaId), limit: v.quotaValue };
    }
  }
  // The SDK sometimes hands us only the serialised body, so fall back to reading the id out of the text.
  const m = /"quotaId"\s*:\s*"([^"]+)"/.exec(messageOf(e));
  return m ? { perDay: /PerDay/i.test(m[1]), limit: /"quotaValue"\s*:\s*"(\d+)"/.exec(messageOf(e))?.[1] } : null;
}

/** A daily cap that says "try again in 33s" is worse than no advice: the retry is guaranteed to fail and you wait for nothing. */
function quotaError(err: unknown, msg: string, model: string): ModelError {
  const q = quotaViolation(err);
  if (q?.perDay) {
    const cap = q.limit ? ` (${q.limit} a day)` : '';
    return new ModelError(`The free Gemini quota for ${model} is used up for today${cap}. It resets at midnight Pacific — or set GEMINI_MODEL to another model, which has its own allowance.`);
  }
  const wait = msg.match(/retry in ([0-9.]+)s/i)?.[1];
  return new ModelError(`The free Gemini quota for ${model} is used up for the minute — try again${wait ? ` in ${Math.ceil(Number(wait))}s` : ' shortly'}.`);
}

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
        // A structured answer wants to be repeatable; a conversation that repeats itself on a follow-up is a worse conversation.
        const cfg: GenerateContentConfig = { temperature: opts.text ? 0.4 : 0.1, abortSignal: AbortSignal.timeout(deadline - Date.now()) };
        if (!opts.text) cfg.responseMimeType = 'application/json';
        if (opts.system) cfg.systemInstruction = opts.system;
        if (thinking) cfg.thinkingConfig = { thinkingLevel: thinking as ThinkingLevel };
        const res = await ai.models.generateContent({ model, contents: asContents(prompt, opts.history), config: cfg });
        return res.text ?? '';
      } catch (e) {
        lastErr = e;
        if (rejectsThinking(e)) { thinking = ''; continue; }
        if (statusOf(e) !== 503) break;
        await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      }
    }
    const msg = messageOf(lastErr);
    if (statusOf(lastErr) === 429 || /RESOURCE_EXHAUSTED|quota/i.test(msg)) throw quotaError(lastErr, msg, model);
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

// ---------------- Asking about a dish (§3 "Asking the model about a dish") ----------------

/** What the model needs to answer in the house's own vocabulary, so a reply can be typed straight into the editor. */
export function chatSystemPrompt(catalog: string[]): string {
  return [
    'You are helping plan and cook for a two-person household. Answer in plain prose and short lists. Never JSON, never a code fence.',
    'House conventions, so an answer can be typed straight into the recipe editor:',
    '- Amounts are for TWO people, one meal. Rescale anything from another source and say that you did.',
    `- US customary units only: ${ALL_UNITS.join(', ')} (floz means fluid ounces). Never metric.`,
    '- Give every ingredient a number, spices, salt and oil included. "To taste" is no use to a shopping list.',
    '- Name each ingredient the way a US supermarket or an Indian grocer labels it. One ingredient per line.',
    ...(catalog.length ? ['- These are already in the catalog. When you mean one of them, use its exact name:', `  ${catalog.join(', ')}`] : []),
    'Keep answers short. Expect follow-up questions and answer them in the same style.',
  ].join('\n');
}

/** One turn of the conversation. The whole history arrives from the browser each time; nothing is stored here. */
export async function askAboutCooking(turns: ChatTurn[], catalog: string[], generate: Generate): Promise<string> {
  const last = turns[turns.length - 1];
  const reply = (await generate(last.text, { history: turns.slice(0, -1), system: chatSystemPrompt(catalog), text: true })).trim();
  if (!reply) throw new ModelError('The model came back with nothing to say — ask again, or put it differently.');
  return reply.slice(0, 8000);
}
