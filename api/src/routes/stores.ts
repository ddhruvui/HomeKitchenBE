import { Router } from 'express';
import { z } from 'zod';
import { IngredientModel, StoreModel } from '../models';
import { asyncH, conflict, notFound, parse } from '../http';

const body = z.object({ name: z.string().trim().min(1), sortOrder: z.number().int().optional(), color: z.string().trim().min(1).optional() });
export const stores = Router();

stores.get('/', asyncH(async (_req, res) => { res.json(await StoreModel.find().sort({ sortOrder: 1, name: 1 })); }));
stores.post('/', asyncH(async (req, res) => {
  const b = parse(body, req.body);
  const sortOrder = b.sortOrder ?? (await StoreModel.countDocuments());
  res.status(201).json(await StoreModel.create({ ...b, sortOrder }));
}));
stores.put('/:id', asyncH(async (req, res) => {
  const doc = await StoreModel.findByIdAndUpdate(req.params.id, parse(body.partial(), req.body), { new: true, runValidators: true });
  if (!doc) throw notFound('store');
  res.json(doc);
}));
stores.delete('/:id', asyncH(async (req, res) => {
  const inUse = await IngredientModel.countDocuments({ storeId: req.params.id });
  if (inUse > 0) throw conflict(`${inUse} ingredient(s) are bought at this store; move them first`);
  const doc = await StoreModel.findByIdAndDelete(req.params.id);
  if (!doc) throw notFound('store');
  res.status(204).end();
}));
