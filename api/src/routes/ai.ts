import { Router } from 'express';
import { z } from 'zod';
import { familyOf, bridgeNeededFor } from '@home-kitchen/shared';
import { asyncH, bad, HttpError, parse } from '../http';

import { loadIngredientMap, loadRecipeMap } from '../loaders';
import { estimateBridges, makeGeminiGenerate, ModelError, type BridgeRequest, type Generate } from '../gemini';
import { config } from '../env';

/** A model that answers badly is a 502 with a reason, never a bare 500 — and a reason already written for a person is left alone. */
async function fromModel<T>(work: Promise<T>): Promise<T> {
  try { return await work; }
  catch (e) {
    if (e instanceof ModelError) throw new HttpError(502, e.message);
    throw new HttpError(502, `Gemini could not do that: ${e instanceof Error ? e.message : String(e)}`);
  }
}

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
  return ai;
}
