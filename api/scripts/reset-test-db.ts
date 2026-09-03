// Drops every collection in the current database — refuses unless its name contains "Test".
import mongoose from 'mongoose';
import { connectDb, currentDbName, disconnectDb } from '../src/db';

(async () => {
  await connectDb();
  const name = currentDbName() ?? '';
  if (!/test/i.test(name)) { console.error(`refusing to reset "${name}" — only databases with "Test" in the name`); process.exit(2); }
  const db = mongoose.connection.db!;
  const cols = await db.collections();
  await Promise.all(cols.map((c) => c.deleteMany({})));
  console.log(`reset ${name}: cleared ${cols.length} collection(s)`);
  await disconnectDb();
})().catch((e) => { console.error(e); process.exit(1); });
