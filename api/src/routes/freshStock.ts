import { Router } from 'express';
import { z } from 'zod';
import { ALL_UNITS, addDays, isValidDate, weekStartFor, daysInRange, generateList, convert, round, MissingBridgeError, UnitMismatchError } from '@home-kitchen/shared';
import { FreshStockModel, IngredientModel } from '../models';
import { asyncH, bad, parse } from '../http';
import { loadDays, loadIngredientMap, loadRecipeMap, loadSettings } from '../loaders';

const entry = z.object({ ingredientId: z.string().min(1), qty: z.number().min(0), unit: z.enum(ALL_UNITS as [string, ...string[]]) });
export const freshStock = Router();

freshStock.get('/', asyncH(async (_req, res) => { res.json(await FreshStockModel.find().sort({ ingredientId: 1 })); }));

/** Replace the whole fridge snapshot in one go — it is rewritten every weekend (§5). */
freshStock.put('/', asyncH(async (req, res) => {
  const entries = parse(z.array(entry), req.body);
  const ids = entries.map((e) => e.ingredientId);
  const docs = await IngredientModel.find({ _id: { $in: ids } }).lean();
  if (docs.length !== new Set(ids).size) throw bad('one or more ingredients do not exist');
  const notFresh = docs.filter((d) => d.kind !== 'fresh');
  if (notFresh.length) throw bad('only fresh ingredients have fridge stock', notFresh.map((d) => d.name));
  await FreshStockModel.deleteMany({});
  if (entries.length) await FreshStockModel.insertMany(entries.map((e) => ({ ...e, enteredAt: new Date() })));
  res.json(await FreshStockModel.find());
}));

/** The short list the fridge screen asks about: fresh ingredients the week's plan uses, with the week's need already in the fridge unit (§5). */
freshStock.get('/needed', asyncH(async (req, res) => {
  const date = parse(z.string().refine(isValidDate), req.query.date ?? new Date().toISOString().slice(0, 10));
  const settings = await loadSettings();
  const start = weekStartFor(date, settings.weekStartsOn), end = addDays(start, 6);
  const [days, recipes, ings] = await Promise.all([loadDays(start, end), loadRecipeMap(), loadIngredientMap()]);
  const wanted = new Set<string>();
  const pantry = new Set<string>();
  const inRange = new Set(daysInRange(start, end));
  for (const d of days) if (inRange.has(d.date)) for (const rid of [...d.breakfast, ...d.dinner]) for (const l of recipes[rid]?.ingredients ?? []) {
    const k = ings[l.ingredientId]?.kind;
    if (k === 'fresh') wanted.add(l.ingredientId);
    if (k === 'pantry') pantry.add(l.ingredientId);
  }
  // the engine, with an empty fridge, tells us what the week needs in each ingredient's base unit
  const gen = generateList({ startDate: start, endDate: end, days, recipes, ingredients: ings, stores: [], freshStock: [], settings });
  const needById = new Map(gen.items.filter((i) => i.source === 'auto').map((i) => [i.ingredientId, i]));
  const problemById = new Map(gen.problems.map((p) => [p.ingredientId, p.reason]));
  const stock = new Map((await FreshStockModel.find().lean()).map((s) => [String(s.ingredientId), s]));
  const rows = [...wanted].map((id) => {
    const ing = ings[id];
    const unit = ing.stockUnit ?? ing.buyUnit ?? null;
    let needQty: number | null = null;
    let problem: string | null = problemById.get(id) ?? null;
    const it = needById.get(id);
    if (it && unit && it.needQty !== undefined && it.needUnit) {
      try { needQty = round(convert(it.needQty, it.needUnit, unit, { ozPerCup: ing.ozPerCup, ozPerCount: ing.ozPerCount, countUnit: ing.countUnit })); }
      catch (e) { if (e instanceof MissingBridgeError || e instanceof UnitMismatchError) problem = e.message; else throw e; }
    }
    const st = stock.get(id);
    return { ingredient: ing, stock: st ? { qty: st.qty, unit: st.unit } : null, needQty, needUnit: unit, problem };
  });
  const pantryRows = [...pantry].map((id) => ({ ingredient: ings[id], isLow: !!ings[id].isLow })).sort((a, b) => a.ingredient.name.localeCompare(b.ingredient.name));
  res.json({ startDate: start, endDate: end, people: settings.people, items: rows.sort((a, b) => a.ingredient.name.localeCompare(b.ingredient.name)), pantry: pantryRows });
}));
