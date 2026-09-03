import mongoose from 'mongoose';
import { connectDb, disconnectDb, currentDbName } from '../db';

export async function openTestDb() {
  await connectDb();
  const name = currentDbName() ?? '';
  if (!/test/i.test(name)) { await disconnectDb(); throw new Error(`refusing to run tests against database "${name}"`); }
}
export async function clearTestDb() {
  const db = mongoose.connection.db;
  if (!db) return;
  const cols = await db.collections();
  await Promise.all(cols.map((c) => c.deleteMany({})));
}
export async function closeTestDb() { await disconnectDb(); }
