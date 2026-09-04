import { Router } from 'express';
import { z } from 'zod';
import { MAX_CARRY_LOOKBACK, addDays, isValidDate, todayView } from '@home-kitchen/shared';
import { asyncH, parse } from '../http';
import { loadDays, loadEkadashi, loadIngredientMap, loadRecipeMap, loadSettings } from '../loaders';

export const today = Router();
/** §4 "Cooking from the plan": derived on read, never stored. The window spans the carry-over lookback
 * behind today and tomorrow ahead of it, because a fast tomorrow is cooked tonight. */
today.get('/', asyncH(async (req, res) => {
  const date = parse(z.string().refine(isValidDate, 'date must be YYYY-MM-DD'), req.query.date ?? new Date().toISOString().slice(0, 10));
  const from = addDays(date, -MAX_CARRY_LOOKBACK), to = addDays(date, 1);
  const [days, ekadashi, recipes, ingredients, settings] = await Promise.all([loadDays(from, to), loadEkadashi(from, to), loadRecipeMap(), loadIngredientMap(), loadSettings()]);
  res.json(todayView({ date, days, ekadashi, recipes, ingredients, settings }));
}));
