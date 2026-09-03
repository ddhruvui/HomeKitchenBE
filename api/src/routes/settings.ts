import { Router } from 'express';
import { z } from 'zod';
import { SettingsModel } from '../models';
import { asyncH, parse } from '../http';

const body = z.object({ people: z.number().int().min(1).max(20).optional(), weekStartsOn: z.number().int().min(0).max(6).optional() });
export const settings = Router();

settings.get('/', asyncH(async (_req, res) => {
  const doc = await SettingsModel.findByIdAndUpdate('settings', { $setOnInsert: { people: 2, weekStartsOn: 6 } }, { upsert: true, new: true });
  res.json(doc);
}));
settings.put('/', asyncH(async (req, res) => {
  const doc = await SettingsModel.findByIdAndUpdate('settings', parse(body, req.body), { upsert: true, new: true, runValidators: true });
  res.json(doc);
}));
