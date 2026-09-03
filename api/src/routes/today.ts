import { Router } from 'express';
import { z } from 'zod';
import { addDays, isValidDate, todayView } from '@home-kitchen/shared';
import { asyncH, parse } from '../http';
import { loadDays, loadIngredientMap, loadRecipeMap, loadSettings } from '../loaders';

export const today = Router();
/** §4 "Cooking from the plan": derived on read, never stored. */
today.get('/', asyncH(async (req, res) => {
  const date = parse(z.string().refine(isValidDate, 'date must be YYYY-MM-DD'), req.query.date ?? new Date().toISOString().slice(0, 10));
  const [days, recipes, ingredients, settings] = await Promise.all([loadDays(addDays(date, -1), date), loadRecipeMap(), loadIngredientMap(), loadSettings()]);
  const day = days.find((d) => d.date === date), prev = days.find((d) => d.date === addDays(date, -1));
  res.json(todayView(day, prev, date, recipes, ingredients, settings));
}));
