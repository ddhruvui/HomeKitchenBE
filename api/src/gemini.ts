import { z } from 'zod';
import { GoogleGenAI, type GenerateContentConfig, type ThinkingLevel } from '@google/genai';
import { config } from './env';
import { ALL_UNITS, FORMS, type Form, type IngredientKind, type Unit } from '@home-kitchen/shared';
import type { ParsedRecipe } from './recipeSource';

export interface BridgeRequest { id: string; name: string; countUnit?: 'each' | 'bunch'; wantCup: boolean; wantCount: boolean; }
export interface BridgeEstimate { id: string; ozPerCup?: number; ozPerCount?: number; rationale: string; }

/** Reading a page or watching a video is slower than answering from memory, so those callers say so and get a longer budget. */
export interface GenerateOpts { videoUrl?: string; readUrl?: boolean; timeoutMs?: number }
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
    const contents = opts.videoUrl ? [{ role: 'user', parts: [{ fileData: { fileUri: opts.videoUrl } }, { text: prompt }] }] : prompt;
    for (let attempt = 0; attempt < 3 && Date.now() < deadline; attempt++) {
      try {
        const cfg: GenerateContentConfig = { responseMimeType: 'application/json', temperature: 0.1, abortSignal: AbortSignal.timeout(deadline - Date.now()) };
        if (thinking) cfg.thinkingConfig = { thinkingLevel: thinking as ThinkingLevel };
        if (opts.readUrl) cfg.tools = [{ urlContext: {} }];
        const res = await ai.models.generateContent({ model, contents, config: cfg });
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

// ---------------- Recipe drafting (§3 "Drafting a recipe with AI") ----------------

const UNIT_ALIASES: Record<string, Unit> = {
  oz: 'oz', ounce: 'oz', ounces: 'oz', lb: 'lb', lbs: 'lb', pound: 'lb', pounds: 'lb',
  tsp: 'tsp', teaspoon: 'tsp', teaspoons: 'tsp', tbsp: 'tbsp', tablespoon: 'tbsp', tablespoons: 'tbsp',
  floz: 'floz', 'fl oz': 'floz', 'fl. oz': 'floz', 'fluid ounce': 'floz', 'fluid ounces': 'floz',
  cup: 'cup', cups: 'cup', pint: 'pint', pints: 'pint', quart: 'quart', quarts: 'quart', qt: 'quart', gallon: 'gallon', gallons: 'gallon', gal: 'gallon',
  each: 'each', piece: 'each', pieces: 'each', pc: 'each', pcs: 'each', whole: 'each', medium: 'each', large: 'each', small: 'each',
  bunch: 'bunch', bunches: 'bunch',
};
export function normalizeUnit(u: unknown): Unit | undefined {
  if (typeof u !== 'string') return undefined;
  const k = u.trim().toLowerCase().replace(/\.$/, '');
  if ((ALL_UNITS as readonly string[]).includes(k)) return k as Unit;
  return UNIT_ALIASES[k];
}

export interface DraftLine { name: string; qty?: number; unit?: Unit; rawUnit?: string; note?: string; kind?: IngredientKind; form?: Form; }
export interface RecipeDraft { title: string; lines: DraftLine[]; steps: string[]; }

const SHAPE = '{"title": string, "ingredients": [{"name": string, "qty": number, "unit": string, "note": string, "kind": string, "form": string}], "steps": [string]}';

/** The house rules every draft obeys, whatever the recipe came from. `serving` is the one line that differs by source. */
function recipeRules(serving: string): string[] {
  return [
    'You write home-cooking recipes for a family shopping app. Return ONLY a JSON object, no prose:', SHAPE,
    'Rules:',
    serving,
    `- US customary units only. "unit" must be one of: ${ALL_UNITS.join(', ')} (floz means fluid ounces). Never metric.`,
    '- Name each ingredient the way it is labelled at a US supermarket or an Indian grocer ("Yellow Onion", "Toor Dal", "Paneer", "Coriander"). One ingredient per line, no combined lines.',
    '- Every ingredient the cook needs, spices, salt and oil included, each with a numeric qty. Never "to taste". Do not list water.',
    '- "kind": "fresh" for produce, dairy, bread and meat bought weekly in recipe amounts; "weekly" for things bought every week regardless (milk, eggs); "pantry" for dry goods, spices, oils, condiments bought in bulk.',
    `- "form" is the aisle, one of: ${FORMS.join(', ')}.`,
    '- "note" is optional prep detail ("finely chopped"). Omit it when there is none.',
    '- "steps": 4 to 10 short imperative sentences in cooking order.',
  ];
}
const quoted = (v: string) => v.replace(/["\\]/g, '');
/** Every source is rescaled on the way in, because every recipe in the book is for two and the household count scales it later. */
const scaleRule = (servings?: number) => servings && servings !== 2
  ? `- The source serves ${servings}. Rescale every amount to TWO people, one meal.`
  : '- Amounts are for TWO people, one meal. Rescale the source if it serves a different number.';

export function buildRecipePrompt(title: string): string {
  return [...recipeRules('- Amounts are for TWO people, one meal.'), `Dish: "${quoted(title)}"`].join('\n');
}

/** The page published its own ingredient list, so the model is only rewriting it into our vocabulary — no invention, no fetching. */
export function buildSourcePrompt(parsed: ParsedRecipe, sourceLabel: string): string {
  return [
    ...recipeRules(scaleRule(parsed.servings)),
    '- Use ONLY the ingredients below. Do not add or drop any. Keep the source\'s own steps, shortened to imperative sentences.',
    `Recipe from ${sourceLabel}${parsed.title ? `, titled "${quoted(parsed.title)}"` : ''}:`,
    'Ingredients:', ...parsed.ingredients.map((l) => `- ${l}`),
    ...(parsed.steps.length ? ['Steps:', ...parsed.steps.map((l, i) => `${i + 1}. ${l}`)] : []),
  ].join('\n');
}

/** No structured data and no video: the model fetches the page itself. Slower, and it fails on sites that block robots. */
export function buildUrlPrompt(url: string): string {
  return [
    ...recipeRules(scaleRule()),
    '- Take the recipe from the page, not from memory. If the page holds no recipe, return {"ingredients": []}.',
    `Read this page and return its recipe: ${quoted(url)}`,
  ].join('\n');
}

/** A video shows one cook making one dish, often including sub-recipes made from scratch; we want the dish. */
export function buildVideoPrompt(): string {
  return [
    ...recipeRules(scaleRule()),
    '- Take the recipe from the video, not from memory. Use the amounts the cook states or shows.',
    '- If the video makes a component from scratch that is normally bought (a spice blend, a paste), list that component as ONE pantry ingredient rather than its sub-ingredients.',
    'Extract the recipe cooked in this video.',
  ].join('\n');
}

const RawDraft = z.object({
  title: z.string().optional(),
  ingredients: z.array(z.object({ name: z.unknown(), qty: z.unknown(), unit: z.unknown(), note: z.unknown(), kind: z.unknown(), form: z.unknown() }).partial()).optional(),
  steps: z.array(z.unknown()).optional(),
});
const KINDS = ['fresh', 'weekly', 'pantry'];
const str = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined);

/** Everything the model returns is untrusted: cap it, coerce it, keep what we cannot interpret as text for the person to fix. */
export function sanitizeRecipeDraft(raw: unknown, requestedTitle: string): RecipeDraft {
  const r = RawDraft.safeParse(raw);
  if (!r.success) throw new Error('model response did not match the expected shape');
  const lines: DraftLine[] = [];
  for (const l of r.data.ingredients ?? []) {
    if (lines.length >= 40) break;
    const name = str(l.name, 60);
    if (!name) continue;
    const line: DraftLine = { name };
    const q = typeof l.qty === 'number' ? l.qty : typeof l.qty === 'string' ? Number(l.qty) : NaN;
    if (Number.isFinite(q) && q > 0 && q <= 1000) line.qty = Math.round(q * 100) / 100;
    const unit = normalizeUnit(l.unit);
    if (unit) line.unit = unit; else if (str(l.unit, 20)) line.rawUnit = str(l.unit, 20);
    if (line.qty === undefined) { delete line.unit; }
    const note = str(l.note, 80); if (note) line.note = note;
    if (typeof l.kind === 'string' && KINDS.includes(l.kind.toLowerCase())) line.kind = l.kind.toLowerCase() as IngredientKind;
    if (typeof l.form === 'string') { const f = (FORMS as readonly string[]).find((x) => x.toLowerCase() === (l.form as string).trim().toLowerCase()); if (f) line.form = f as Form; }
    lines.push(line);
  }
  if (lines.length === 0) throw new Error('the model returned no ingredients');
  const steps = (r.data.steps ?? []).slice(0, 30).map((s) => str(s, 300)).filter((s): s is string => !!s);
  return { title: str(r.data.title, 80) ?? requestedTitle, lines, steps };
}

export async function draftRecipe(title: string, generate: Generate): Promise<RecipeDraft> {
  return sanitizeRecipeDraft(extractJsonValue(await generate(buildRecipePrompt(title))), title);
}

/** A draft from a link or a video. `fallbackTitle` is used only when the source gave us no name of its own. */
export async function draftFromSource(
  generate: Generate,
  fallbackTitle: string,
  prompt: string,
  opts: GenerateOpts,
): Promise<RecipeDraft> {
  return sanitizeRecipeDraft(extractJsonValue(await generate(prompt, opts)), fallbackTitle);
}
function extractJsonValue(text: string): unknown {
  const t = unfence(text);
  try { return JSON.parse(t); } catch { /* ditto */ }
  const m = firstJsonValue(t, '{');
  if (!m) throw new Error('model returned no JSON object');
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
