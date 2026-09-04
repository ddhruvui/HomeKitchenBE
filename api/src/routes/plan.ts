import { Router } from 'express';
import { z } from 'zod';
import { MAX_CARRY_LOOKBACK, addDays, cookAheadDate, cookedOn, daysInRange, isValidDate, lunchSourceDate, weekStartFor } from '@home-kitchen/shared';
import { PlannedDayModel, RecipeModel } from '../models';
import { asyncH, bad, parse } from '../http';
import { loadDays, loadEkadashi, loadRecipeMap, loadSettings } from '../loaders';

const dateParam = z.string().refine(isValidDate, 'date must be YYYY-MM-DD');
const body = z.object({ breakfast: z.array(z.string()).default([]), dinner: z.array(z.string()).default([]) });

export async function weekBounds(date: string) {
  const settings = await loadSettings();
  const startDate = weekStartFor(date, settings.weekStartsOn);
  return { settings, startDate, endDate: addDays(startDate, 6) };
}

export const plan = Router();

/**
 * The week containing `date`, seven days always, with the derived lunch on each (§4). The window
 * reaches a week back because a fast day's carry-over skips it, and one day past the end because
 * the last evening may be cooking for the first day of the next week.
 */
plan.get('/week', asyncH(async (req, res) => {
  const date = parse(dateParam, req.query.date ?? new Date().toISOString().slice(0, 10));
  const { startDate, endDate } = await weekBounds(date);
  const from = addDays(startDate, -MAX_CARRY_LOOKBACK), to = addDays(endDate, 1);
  const [days, fasts, recipes] = await Promise.all([loadDays(from, to), loadEkadashi(from, to), loadRecipeMap()]);
  const byDate = new Map(days.map((d) => [d.date, d]));
  const marked = new Set(fasts);
  const isEkadashi = (d: string) => marked.has(d);
  const refs = (ids: string[] | undefined) => (ids ?? []).map((id) => ({ id, title: recipes[id]?.title ?? null }));
  res.json({
    startDate, endDate,
    days: daysInRange(startDate, endDate).map((date) => {
      const source = lunchSourceDate(date, isEkadashi), ahead = cookAheadDate(date, isEkadashi);
      const lunch = refs(source === null ? [] : byDate.get(source)?.dinner);
      const dishes = refs(ahead === null ? [] : byDate.get(ahead)?.dinner);
      return {
        date, isEkadashi: isEkadashi(date),
        breakfast: refs(byDate.get(date)?.breakfast),
        lunch, lunchFrom: lunch.length > 0 && source !== null ? cookedOn(source, isEkadashi) : null,
        dinner: refs(byDate.get(date)?.dinner),
        dinnerCookedOn: cookedOn(date, isEkadashi),
        cookAhead: ahead !== null && dishes.length > 0 ? { date: ahead, dishes } : null,
      };
    }),
  });
}));

plan.put('/:date', asyncH(async (req, res) => {
  const date = parse(dateParam, req.params.date);
  const v = parse(body, req.body);
  const ids = [...new Set([...v.breakfast, ...v.dinner])];
  const found = await RecipeModel.countDocuments({ _id: { $in: ids } });
  if (found !== ids.length) throw bad('one or more recipes do not exist');
  const doc = await PlannedDayModel.findOneAndUpdate({ date }, { date, ...v }, { upsert: true, new: true, runValidators: true });
  res.json(doc);
}));

/** Copy last week: every day of the source week onto the target week, overwriting (§4). */
plan.post('/copy', asyncH(async (req, res) => {
  const { fromDate, toDate } = parse(z.object({ fromDate: dateParam, toDate: dateParam }), req.body);
  const { settings } = await weekBounds(fromDate);
  const from = weekStartFor(fromDate, settings.weekStartsOn), to = weekStartFor(toDate, settings.weekStartsOn);
  const src = await loadDays(from, addDays(from, 6));
  const byDate = new Map(src.map((d) => [d.date, d]));
  let written = 0;
  for (let i = 0; i < 7; i++) {
    const s = byDate.get(addDays(from, i));
    const date = addDays(to, i);
    await PlannedDayModel.findOneAndUpdate({ date }, { date, breakfast: s?.breakfast ?? [], dinner: s?.dinner ?? [] }, { upsert: true });
    if (s) written++;
  }
  res.json({ from, to, daysCopied: written });
}));
