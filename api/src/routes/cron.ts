import { Router } from 'express';
import { addDays } from '@home-kitchen/shared';
import { EkadashiDayModel, PlannedDayModel } from '../models';
import { asyncH, unauthorized } from '../http';

/** How much of the past is worth keeping: three weeks. Older plans are weeks nobody opens again. */
export const KEEP_DAYS = 21;

export const cron = Router();

// Vercel sends `Authorization: Bearer $CRON_SECRET` when that variable is set on the project;
// with no secret set (local development, tests) the route is open.
cron.use((req, _res, next) => {
  const secret = process.env.CRON_SECRET;
  if (secret && req.get('authorization') !== `Bearer ${secret}`) throw unauthorized();
  next();
});

/** Delete planned days, and the fast days beside them, older than three weeks. GET because a Vercel cron only ever issues GETs (§8). */
cron.get('/cleanup', asyncH(async (_req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const before = addDays(today, -KEEP_DAYS);
  // dates are YYYY-MM-DD strings, so "older than" is a plain string comparison (§12 J)
  const stale = { date: { $lt: before } };
  const [plans, fasts] = await Promise.all([PlannedDayModel.deleteMany(stale), EkadashiDayModel.deleteMany(stale)]);
  res.json({ ok: true, today, before, deletedPlannedDays: plans.deletedCount, deletedEkadashiDays: fasts.deletedCount });
}));
