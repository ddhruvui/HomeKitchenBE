import { Router } from 'express';
import { z } from 'zod';
import { ALL_UNITS, COUNT_UNITS, FORMS, bridgeNeededFor, isValidDate } from '@home-kitchen/shared';
import { IngredientModel, RecipeModel, StoreModel } from '../models';
import { asyncH, bad, conflict, notFound, parse } from '../http';
import { loadIngredientMap, loadRecipeMap } from '../loaders';

const unit = z.enum(ALL_UNITS as [string, ...string[]]);
const body = z.object({
  name: z.string().trim().min(1),
  kind: z.enum(['fresh', 'weekly', 'pantry']),
  storeId: z.string().min(1),
  form: z.enum(FORMS as unknown as [string, ...string[]]),
  weeklyQty: z.number().positive().optional(),
  buyUnit: unit.optional(),
  stockUnit: unit.optional(),
  countUnit: z.enum(COUNT_UNITS as [string, ...string[]]).optional(),
  ozPerCup: z.number().positive().optional(),
  ozPerCount: z.number().positive().optional(),
  expiresOn: z.string().refine(isValidDate, 'expiresOn must be YYYY-MM-DD').nullable().optional(),
}).superRefine((v, ctx) => {
  if (v.kind === 'fresh' && !v.buyUnit) ctx.addIssue({ code: 'custom', path: ['buyUnit'], message: 'a fresh ingredient needs a buy unit' });
  if (v.kind === 'weekly' && v.weeklyQty === undefined) ctx.addIssue({ code: 'custom', path: ['weeklyQty'], message: 'a weekly ingredient needs a weekly quantity' });
  if (v.kind !== 'pantry' && v.expiresOn) ctx.addIssue({ code: 'custom', path: ['expiresOn'], message: 'only pantry ingredients carry an expiry date' });
});

/** Strip the fields that do not apply to a kind, so a pantry item never carries a stray buy unit. */
function shape(v: z.infer<typeof body>) {
  const out: Record<string, unknown> = { name: v.name, kind: v.kind, storeId: v.storeId, form: v.form };
  if (v.kind === 'weekly') out.weeklyQty = v.weeklyQty;
  if (v.kind === 'pantry' && v.expiresOn) out.expiresOn = v.expiresOn;
  if (v.kind === 'fresh') { out.buyUnit = v.buyUnit; out.stockUnit = v.stockUnit ?? v.buyUnit; out.countUnit = v.countUnit; out.ozPerCup = v.ozPerCup; out.ozPerCount = v.ozPerCount; }
  return out;
}

export const ingredients = Router();

ingredients.get('/', asyncH(async (req, res) => {
  const q: Record<string, unknown> = {};
  if (typeof req.query.kind === 'string') q.kind = req.query.kind;
  if (req.query.low === 'true') q.isLow = true;
  if (req.query.expiring === 'true') { q.expiresOn = { $exists: true, $ne: null }; return res.json(await IngredientModel.find(q).sort({ expiresOn: 1, name: 1 })); }
  res.json(await IngredientModel.find(q).sort({ name: 1 }));
}));

/** Fresh ingredients that some recipe uses in a unit they cannot yet convert (§3, §12 G). */
ingredients.get('/needs-bridge', asyncH(async (_req, res) => {
  const [ings, recipes] = await Promise.all([loadIngredientMap(), loadRecipeMap()]);
  const out = new Map<string, { ingredient: unknown; needs: Set<string>; units: Set<string> }>();
  for (const r of Object.values(recipes)) for (const l of r.ingredients) {
    const ing = ings[l.ingredientId];
    if (!ing || !l.unit) continue;
    const need = bridgeNeededFor(ing, l.unit);
    if (!need) continue;
    const e = out.get(ing.id) ?? { ingredient: ing, needs: new Set(), units: new Set() };
    e.needs.add(need); e.units.add(l.unit); out.set(ing.id, e);
  }
  res.json([...out.values()].map((e) => ({ ingredient: e.ingredient, needs: [...e.needs], units: [...e.units] })));
}));

ingredients.post('/', asyncH(async (req, res) => {
  const v = parse(body, req.body);
  if (!(await StoreModel.exists({ _id: v.storeId }))) throw bad('unknown store');
  if (await IngredientModel.exists({ nameKey: v.name.toLowerCase() })) throw conflict(`an ingredient named "${v.name}" already exists`);
  res.status(201).json(await IngredientModel.create(shape(v)));
}));

ingredients.put('/:id', asyncH(async (req, res) => {
  const existing = await IngredientModel.findById(req.params.id);
  if (!existing) throw notFound('ingredient');
  const v = parse(body, { ...existing.toObject(), ...req.body, storeId: String(req.body.storeId ?? existing.storeId) });
  const dup = await IngredientModel.exists({ nameKey: v.name.toLowerCase(), _id: { $ne: existing._id } });
  if (dup) throw conflict(`an ingredient named "${v.name}" already exists`);
  const fresh = shape(v);
  for (const k of ['weeklyQty', 'buyUnit', 'stockUnit', 'countUnit', 'ozPerCup', 'ozPerCount', 'expiresOn'] as const) if (!(k in fresh)) existing.set(k, undefined);
  existing.set(fresh);
  await existing.save();
  res.json(existing);
}));

/** The Low flag: pantry only (§2). Anything else is a 400. */
ingredients.patch('/:id/low', asyncH(async (req, res) => {
  const { isLow } = parse(z.object({ isLow: z.boolean() }), req.body);
  const doc = await IngredientModel.findById(req.params.id);
  if (!doc) throw notFound('ingredient');
  if (doc.kind !== 'pantry') throw bad('only pantry ingredients can be marked low');
  doc.isLow = isLow; await doc.save();
  res.json(doc);
}));

/** AI-estimated bridges land here after the user confirms them (§3 step 4). */
ingredients.patch('/:id/bridges', asyncH(async (req, res) => {
  const b = parse(z.object({ ozPerCup: z.number().positive().optional(), ozPerCount: z.number().positive().optional() }), req.body);
  const doc = await IngredientModel.findById(req.params.id);
  if (!doc) throw notFound('ingredient');
  if (doc.kind !== 'fresh') throw bad('only fresh ingredients carry conversions');
  if (b.ozPerCup !== undefined) doc.ozPerCup = b.ozPerCup;
  if (b.ozPerCount !== undefined) doc.ozPerCount = b.ozPerCount;
  await doc.save();
  res.json(doc);
}));

ingredients.delete('/:id', asyncH(async (req, res) => {
  const used = await RecipeModel.countDocuments({ 'ingredients.ingredientId': req.params.id });
  if (used > 0) throw conflict(`${used} recipe(s) use this ingredient; remove it from them first`);
  const doc = await IngredientModel.findByIdAndDelete(req.params.id);
  if (!doc) throw notFound('ingredient');
  res.status(204).end();
}));
