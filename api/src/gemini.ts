import { z } from 'zod';
import { GoogleGenAI } from '@google/genai';
import { config } from './env';
import { ALL_UNITS, FORMS, type Form, type IngredientKind, type Unit } from '@home-kitchen/shared';

export interface BridgeRequest { id: string; name: string; countUnit?: 'each' | 'bunch'; wantCup: boolean; wantCount: boolean; }
export interface BridgeEstimate { id: string; ozPerCup?: number; ozPerCount?: number; rationale: string; }

/** The one function that knows a model exists. Injected so tests never call the network. */
export type Generate = (prompt: string) => Promise<string>;

export function makeGeminiGenerate(apiKey = config.geminiKey, model = config.geminiModel): Generate {
  if (!apiKey) throw new Error('GEMINI_API_KEY is not set');
  const ai = new GoogleGenAI({ apiKey });
  // Gemini answers 429/503 under load; those are worth a couple of short retries before the user hears about it.
  return async (prompt) => {
    let lastErr: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await ai.models.generateContent({ model, contents: prompt, config: { responseMimeType: 'application/json', temperature: 0.1 } });
        return res.text ?? '';
      } catch (e) {
        lastErr = e;
        const status = (e as { status?: number })?.status;
        if (status !== 429 && status !== 503) break;
        await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      }
    }
    const msg = lastErr instanceof Error ? lastErr.message : String(lastErr);
    throw new Error(/UNAVAILABLE|high demand|503/.test(msg) ? 'the model is busy right now — try again in a moment' : msg);
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

function extractJson(text: string): unknown {
  const t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try { return JSON.parse(t); } catch { /* fall through */ }
  const m = t.match(/\[[\s\S]*\]/);
  if (!m) throw new Error('model returned no JSON array');
  return JSON.parse(m[0]);
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

export function buildRecipePrompt(title: string): string {
  return [
    'You write home-cooking recipes for a family shopping app. Return ONLY a JSON object, no prose:',
    '{"title": string, "ingredients": [{"name": string, "qty": number, "unit": string, "note": string, "kind": string, "form": string}], "steps": [string]}',
    'Rules:',
    '- Amounts are for TWO people, one meal.',
    `- US customary units only. "unit" must be one of: ${ALL_UNITS.join(', ')} (floz means fluid ounces). Never metric.`,
    '- Name each ingredient the way it is labelled at a US supermarket or an Indian grocer ("Yellow Onion", "Toor Dal", "Paneer", "Coriander"). One ingredient per line, no combined lines.',
    '- Every ingredient the cook needs, spices, salt and oil included, each with a numeric qty. Never "to taste". Do not list water.',
    '- "kind": "fresh" for produce, dairy, bread and meat bought weekly in recipe amounts; "weekly" for things bought every week regardless (milk, eggs); "pantry" for dry goods, spices, oils, condiments bought in bulk.',
    `- "form" is the aisle, one of: ${FORMS.join(', ')}.`,
    '- "note" is optional prep detail ("finely chopped"). Omit it when there is none.',
    '- "steps": 4 to 10 short imperative sentences in cooking order.',
    `Dish: "${title.replace(/["\\]/g, '')}"`,
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
function extractJsonValue(text: string): unknown {
  const t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try { return JSON.parse(t); } catch { /* fall through */ }
  const m = t.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('model returned no JSON object');
  return JSON.parse(m[0]);
}

/** §3 steps 2–3: one call for the whole batch, then the sanitizer. Nothing is written here; the caller confirms. */
export async function estimateBridges(reqs: BridgeRequest[], generate: Generate): Promise<BridgeEstimate[]> {
  if (reqs.length === 0) return [];
  const parsed = Raw.safeParse(extractJson(await generate(buildPrompt(reqs))));
  if (!parsed.success) throw new Error('model response did not match the expected shape');
  const wanted = new Set(reqs.map((r) => r.id));
  return parsed.data.filter((e) => wanted.has(e.id)).map(sanitize).filter((e): e is BridgeEstimate => e !== null);
}
