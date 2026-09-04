import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { z } from 'zod';

export class HttpError extends Error {
  constructor(public readonly status: number, message: string, public readonly details?: unknown) { super(message); this.name = 'HttpError'; }
}
export const notFound = (what: string) => new HttpError(404, `${what} not found`);
export const bad = (message: string, details?: unknown) => new HttpError(400, message, details);
export const conflict = (message: string) => new HttpError(409, message);
export const unauthorized = (message = 'unauthorized') => new HttpError(401, message);

export const asyncH = (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) => { fn(req, res, next).catch(next); };

export function parse<S extends z.ZodTypeAny>(schema: S, data: unknown): z.output<S> {
  const r = schema.safeParse(data);
  if (!r.success) throw bad('invalid request', r.error.flatten());
  return r.data;
}
