import mongoose from 'mongoose';
import { resolveDbName, resolveMongoUri } from './env';

/** Cached on the global so a warm serverless instance reuses one connection (§8). */
interface Cache { promise: Promise<typeof mongoose> | null; dbName: string | null; }
const g = globalThis as unknown as { __homeKitchenMongo?: Cache };
const cache: Cache = g.__homeKitchenMongo ?? (g.__homeKitchenMongo = { promise: null, dbName: null });

export async function connectDb(): Promise<typeof mongoose> {
  const dbName = resolveDbName();
  if (!cache.promise || cache.dbName !== dbName) {
    cache.dbName = dbName;
    cache.promise = mongoose.connect(resolveMongoUri(), { dbName, maxPoolSize: 5, serverSelectionTimeoutMS: 15000 }).catch((e) => {
      cache.promise = null; cache.dbName = null; throw e;
    });
  }
  return cache.promise;
}
export async function disconnectDb(): Promise<void> {
  await mongoose.disconnect();
  cache.promise = null; cache.dbName = null;
}
export function currentDbName(): string | null { return cache.dbName; }
