import { Router } from 'express';
import { z } from 'zod';
import { ALL_UNITS, validateRecipeLine } from '@home-kitchen/shared';
import { PlannedDayModel, RecipeModel } from '../models';
import { asyncH, bad, conflict, notFound, parse } from '../http';
import { loadIngredientMap } from '../loaders';

const line = z.object({ ingredientId: z.string().min(1), qty: z.number().optional(), unit: z.enum(ALL_UNITS as [string, ...string[]]).optional(), note: z.string().trim().optional() });
const body = z.object({ title: z.string().trim().min(1), ingredients: z.array(line).default([]), steps: z.array(z.string().trim()).default([]), tags: z.array(z.string().trim()).default([]) });

async function checkLines(lines: z.infer<typeof line>[]) {
  const ings = await loadIngredientMap();
  const errors = lines.map((l, i) => ({ i, error: validateRecipeLine(l as Parameters<typeof validateRecipeLine>[0], ings[l.ingredientId]) })).filter((e) => e.error);
  if (errors.length) throw bad('invalid ingredient lines', errors);
}

export const recipes = Router();
recipes.get('/', asyncH(async (_req, res) => { res.json(await RecipeModel.find().sort({ title: 1 })); }));
recipes.get('/:id', asyncH(async (req, res) => { const d = await RecipeModel.findById(req.params.id); if (!d) throw notFound('recipe'); res.json(d); }));
recipes.post('/', asyncH(async (req, res) => {
  const v = parse(body, req.body);
  await checkLines(v.ingredients);
  res.status(201).json(await RecipeModel.create(v));
}));
recipes.put('/:id', asyncH(async (req, res) => {
  const v = parse(body, req.body);
  await checkLines(v.ingredients);
  const d = await RecipeModel.findByIdAndUpdate(req.params.id, v, { new: true, runValidators: true });
  if (!d) throw notFound('recipe');
  res.json(d);
}));
recipes.delete('/:id', asyncH(async (req, res) => {
  const planned = await PlannedDayModel.countDocuments({ $or: [{ breakfast: req.params.id }, { dinner: req.params.id }] });
  if (planned > 0) throw conflict(`this recipe is on ${planned} planned day(s); remove it from the plan first`);
  const d = await RecipeModel.findByIdAndDelete(req.params.id);
  if (!d) throw notFound('recipe');
  res.status(204).end();
}));
