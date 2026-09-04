import express, { type NextFunction, type Request, type Response } from 'express';
import cors from 'cors';
import mongoose from 'mongoose';
import { connectDb, currentDbName } from './db';
import { ensureDefaultStores } from './defaults';
import { HttpError } from './http';
import { stores } from './routes/stores';
import { settings } from './routes/settings';
import { ingredients } from './routes/ingredients';
import { recipes } from './routes/recipes';
import { plan } from './routes/plan';
import { freshStock } from './routes/freshStock';
import { lists } from './routes/lists';
import { today } from './routes/today';
import { ekadashi } from './routes/ekadashi';
import { aiRoutes } from './routes/ai';
import { cron } from './routes/cron';
import type { Generate } from './gemini';

export function buildApp(opts: { generate?: Generate } = {}) {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '1mb' }));

  // The bare domain is a Vercel 404 otherwise; answered without touching Mongo.
  app.get('/', (_req, res) => res.json({
    name: 'Home Kitchen API',
    health: '/api/health',
    routes: ['/api/stores', '/api/settings', '/api/ingredients', '/api/recipes', '/api/plan', '/api/fresh-stock', '/api/lists', '/api/today', '/api/ekadashi', '/api/ai'],
  }));

  app.get('/api/health', async (_req, res, next) => {
    try { await connectDb(); res.json({ ok: true, db: currentDbName() }); } catch (e) { next(e); }
  });
  const g = globalThis as unknown as { __homeKitchenDefaults?: Promise<unknown> };
  app.use('/api', async (_req, _res, next) => {
    try { await connectDb(); if (!g.__homeKitchenDefaults) g.__homeKitchenDefaults = ensureDefaultStores(); await g.__homeKitchenDefaults; next(); } catch (e) { next(e); }
  });

  app.use('/api/stores', stores);
  app.use('/api/settings', settings);
  app.use('/api/ingredients', ingredients);
  app.use('/api/recipes', recipes);
  app.use('/api/plan', plan);
  app.use('/api/fresh-stock', freshStock);
  app.use('/api/lists', lists);
  app.use('/api/today', today);
  app.use('/api/ekadashi', ekadashi);
  app.use('/api/ai', aiRoutes(opts.generate));
  app.use('/api/cron', cron);

  app.use((req, res) => { res.status(404).json({ error: `no route for ${req.method} ${req.path}` }); });
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, details: err.details });
    if (err instanceof mongoose.Error.ValidationError) return res.status(400).json({ error: err.message });
    if (err instanceof mongoose.Error.CastError) return res.status(404).json({ error: 'not found' });
    const code = (err as { code?: number })?.code;
    if (code === 11000) return res.status(409).json({ error: 'already exists' });
    console.error(err);
    res.status(500).json({ error: 'internal error' });
  });
  return app;
}

const app = buildApp();
export default app;
