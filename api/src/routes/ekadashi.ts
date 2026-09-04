import { Router } from 'express';
import { z } from 'zod';
import { isValidDate } from '@home-kitchen/shared';
import { EkadashiDayModel } from '../models';
import { asyncH, parse } from '../http';

const dateParam = z.string().refine(isValidDate, 'date must be YYYY-MM-DD');
const body = z.object({ name: z.string().trim().max(60).nullable().optional() });

export const ekadashi = Router();

/** Every marked fast day, ascending; `from`/`to` narrow it to the window a page is showing (§4). */
ekadashi.get('/', asyncH(async (req, res) => {
  const range: Record<string, string> = {};
  if (typeof req.query.from === 'string') range.$gte = parse(dateParam, req.query.from);
  if (typeof req.query.to === 'string') range.$lte = parse(dateParam, req.query.to);
  res.json(await EkadashiDayModel.find(Object.keys(range).length ? { date: range } : {}).sort({ date: 1 }));
}));

// Marking is idempotent — the calendar is edited by re-saving it. A name only moves when one is sent,
// so re-marking a named date keeps its name; an empty name is how you take the name back off (§4).
ekadashi.put('/:date', asyncH(async (req, res) => {
  const date = parse(dateParam, req.params.date);
  const { name } = parse(body, req.body ?? {});
  const update = name === undefined ? { $set: { date } } : name ? { $set: { date, name } } : { $set: { date }, $unset: { name: '' } };
  res.json(await EkadashiDayModel.findOneAndUpdate({ date }, update, { upsert: true, new: true, runValidators: true }));
}));

/** Unmarking a date that was never marked is the same outcome, so it is the same 204. */
ekadashi.delete('/:date', asyncH(async (req, res) => {
  await EkadashiDayModel.deleteOne({ date: parse(dateParam, req.params.date) });
  res.status(204).end();
}));
