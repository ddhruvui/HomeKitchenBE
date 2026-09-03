import { Router } from 'express';
import { z } from 'zod';
import { generateList, mergeLists, isValidDate, type ShoppingItem } from '@home-kitchen/shared';
import { IngredientModel, ShoppingListModel } from '../models';
import { asyncH, bad, notFound, parse } from '../http';
import { loadDays, loadFreshStock, loadIngredientMap, loadRecipeMap, loadStores } from '../loaders';
import { weekBounds } from './plan';

const dateParam = z.string().refine(isValidDate, 'date must be YYYY-MM-DD');
export const lists = Router();

lists.get('/', asyncH(async (req, res) => {
  if (typeof req.query.date === 'string') {
    const { startDate } = await weekBounds(parse(dateParam, req.query.date));
    const doc = await ShoppingListModel.findOne({ startDate });
    if (!doc) throw notFound('list for that week');
    return res.json(doc);
  }
  res.json(await ShoppingListModel.find().sort({ startDate: -1 }).limit(12));
}));

lists.get('/:id', asyncH(async (req, res) => { const d = await ShoppingListModel.findById(req.params.id); if (!d) throw notFound('list'); res.json(d); }));

/** One list per week; generating again merges so Sunday's re-plan does not un-buy Saturday's shopping (§5, §12 F). */
lists.post('/generate', asyncH(async (req, res) => {
  const { date } = parse(z.object({ date: dateParam }), req.body);
  const { settings, startDate, endDate } = await weekBounds(date);
  const [days, recipes, ingredients, stores, freshStock] = await Promise.all([loadDays(startDate, endDate), loadRecipeMap(), loadIngredientMap(), loadStores(), loadFreshStock()]);
  const generated = generateList({ startDate, endDate, days, recipes, ingredients, stores, freshStock, settings });
  const existing = await ShoppingListModel.findOne({ startDate });
  const items = mergeLists(existing?.toObject().items as ShoppingItem[] | undefined, generated.items);
  const doc = await ShoppingListModel.findOneAndUpdate(
    { startDate },
    { startDate, endDate, generatedAt: new Date(), status: 'active', people: settings.people, items, problems: generated.problems, pantryCheck: generated.pantryCheck },
    { upsert: true, new: true });
  res.status(existing ? 200 : 201).json(doc);
}));

/** Ticking marks the ingredient replenished where that applies, and never removes the line (§5). */
lists.patch('/:id/items/:ingredientId', asyncH(async (req, res) => {
  const { checked } = parse(z.object({ checked: z.boolean() }), req.body);
  const doc = await ShoppingListModel.findById(req.params.id);
  if (!doc) throw notFound('list');
  const item = doc.items.find((i) => i.ingredientId === req.params.ingredientId);
  if (!item) throw notFound('item');
  item.checked = checked;
  await doc.save();
  if (item.source === 'low') await IngredientModel.findByIdAndUpdate(item.ingredientId, { isLow: !checked });
  res.json(doc);
}));

/** From the list's "check the pantry" reminder: flag an ingredient low and put it on this list right now (§2). */
lists.patch('/:id/pantry/:ingredientId', asyncH(async (req, res) => {
  const { isLow } = parse(z.object({ isLow: z.boolean() }), req.body);
  const doc = await ShoppingListModel.findById(req.params.id);
  if (!doc) throw notFound('list');
  const ing = await IngredientModel.findById(req.params.ingredientId);
  if (!ing || ing.kind !== 'pantry') throw bad('not a pantry ingredient');
  ing.isLow = isLow; await ing.save();
  const entry = doc.pantryCheck.find((p) => p.ingredientId === ing.id);
  if (entry) entry.isLow = isLow; else doc.pantryCheck.push({ ingredientId: ing.id, name: ing.name, storeId: String(ing.storeId), isLow });
  const existing = doc.items.find((i) => i.ingredientId === ing.id && i.source === 'low');
  if (isLow && !existing) doc.items.push({ ingredientId: ing.id, name: ing.name, storeId: String(ing.storeId), group: 'Running low', source: 'low', checked: false });
  if (!isLow && existing && !existing.checked) doc.items = doc.items.filter((i) => !(i.ingredientId === ing.id && i.source === 'low')) as typeof doc.items;
  await doc.save();
  res.json(doc);
}));

lists.post('/:id/items', asyncH(async (req, res) => {
  const v = parse(z.object({ name: z.string().trim().min(1), storeId: z.string().min(1), group: z.string().trim().default('Other') }), req.body);
  const doc = await ShoppingListModel.findById(req.params.id);
  if (!doc) throw notFound('list');
  const ingredientId = 'manual-' + Date.now().toString(36);
  doc.items.push({ ingredientId, name: v.name, storeId: v.storeId, group: v.group, source: 'manual', checked: false });
  await doc.save();
  res.status(201).json(doc);
}));

lists.delete('/:id/items/:ingredientId', asyncH(async (req, res) => {
  const doc = await ShoppingListModel.findById(req.params.id);
  if (!doc) throw notFound('list');
  const before = doc.items.length;
  doc.items = doc.items.filter((i) => !(i.ingredientId === req.params.ingredientId && i.source === 'manual')) as typeof doc.items;
  if (doc.items.length === before) throw bad('only manual items can be removed; regenerate to change the rest');
  await doc.save();
  res.json(doc);
}));
