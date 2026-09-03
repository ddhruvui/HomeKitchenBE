// Puts the four stores into whichever database USE_TEST_DB selects, without touching anything that already exists.
//   npm run seed:stores -w api                      → HomeKitchenTest
//   USE_TEST_DB=false npm run seed:stores -w api    → HomeKitchen (production)
import { connectDb, currentDbName, disconnectDb } from '../src/db';
import { ensureDefaultStores } from '../src/defaults';
import { StoreModel } from '../src/models';

(async () => {
  await connectDb();
  const { added } = await ensureDefaultStores();
  const all = await StoreModel.find().sort({ sortOrder: 1 }).lean();
  console.log(`${currentDbName()}: added ${added.length ? added.join(', ') : 'nothing'}; stores now: ${all.map((s) => s.name).join(' · ')}`);
  await disconnectDb();
})().catch((e) => { console.error(e); process.exit(1); });
