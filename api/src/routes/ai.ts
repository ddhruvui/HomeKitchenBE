import { Router } from 'express';
import { z } from 'zod';
import { familyOf, bridgeNeededFor } from '@home-kitchen/shared';
import { asyncH, bad, HttpError, parse } from '../http';

/** A model that answers badly is a 502 with a reason, never a bare 500. */
async function fromModel<T>(work: Promise<T>): Promise<T> {
  try { return await work; }
  catch (e) { throw new HttpError(502, `Gemini could not do that: ${e instanceof Error ? e.message : String(e)}`); }
}
import { loadIngredientMap, loadRecipeMap } from '../loaders';
import { draftRecipe, estimateBridges, makeGeminiGenerate, type BridgeRequest, type Generate } from '../gemini';
import { matchIngredient } from '../match';
import { config } from '../env';

export function aiRoutes(generate?: Generate) {
  const ai = Router();
  /** Suggest bridges for the given fresh ingredients (or every one that needs a bridge). Suggestions only — confirm via PATCH /ingredients/:id/bridges. */
  ai.post('/bridges', asyncH(async (req, res) => {
    const { ingredientIds } = parse(z.object({ ingredientIds: z.array(z.string()).optional() }), req.body ?? {});
    const [ings, recipes] = await Promise.all([loadIngredientMap(), loadRecipeMap()]);
    const wants = new Map<string, BridgeRequest>();
    for (const r of Object.values(recipes)) for (const l of r.ingredients) {
      const ing = ings[l.ingredientId];
      if (!ing || ing.kind !== 'fresh' || !l.unit) continue;
      if (ingredientIds && !ingredientIds.includes(ing.id)) continue;
      const need = bridgeNeededFor(ing, l.unit);
      if (!need) continue;
      const w = wants.get(ing.id) ?? { id: ing.id, name: ing.name, countUnit: ing.countUnit, wantCup: false, wantCount: false };
      if (need === 'ozPerCup' || familyOf(l.unit) === 'volume') w.wantCup = true;
      if (need === 'ozPerCount') w.wantCount = true;
      wants.set(ing.id, w);
    }
    if (ingredientIds) for (const id of ingredientIds) {
      const ing = ings[id];
      if (ing && ing.kind === 'fresh' && !wants.has(id)) wants.set(id, { id, name: ing.name, countUnit: ing.countUnit, wantCup: !ing.ozPerCup, wantCount: !!ing.countUnit && !ing.ozPerCount });
    }
    const reqs = [...wants.values()].filter((w) => w.wantCup || w.wantCount);
    if (reqs.length === 0) return res.json({ estimates: [], model: config.geminiModel });
    const gen = generate ?? (() => { if (!config.geminiKey) throw bad('GEMINI_API_KEY is not configured; enter conversions by hand'); return makeGeminiGenerate(); })();
    const estimates = await fromModel(estimateBridges(reqs, gen));
    res.json({ estimates: estimates.map((e) => ({ ...e, name: ings[e.id]?.name })), model: config.geminiModel });
  }));
  /** Draft a recipe for two from a dish name (§3). Lines come back matched to the catalog; nothing is written. */
  ai.post('/recipe', asyncH(async (req, res) => {
    const { title } = parse(z.object({ title: z.string().trim().min(2).max(80) }), req.body ?? {});
    const gen = generate ?? (() => { if (!config.geminiKey) throw bad('GEMINI_API_KEY is not configured'); return makeGeminiGenerate(); })();
    const draft = await fromModel(draftRecipe(title, gen));
    const catalog = Object.values(await loadIngredientMap());
    const lines = draft.lines.map((l) => {
      const m = matchIngredient(l.name, catalog);
      return { ...l, match: m ? { ingredientId: m.ingredient.id, name: m.ingredient.name, kind: m.ingredient.kind, confidence: m.confidence } : null };
    });
    res.json({ title: draft.title, servings: 2, lines, steps: draft.steps, model: config.geminiModel });
  }));
  return ai;
}
