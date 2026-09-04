// Copies one database to another on the same cluster — HomeKitchenTest → HomeKitchen by default.
// Reports only, unless you pass --write; --write replaces the target's copy of each source collection,
// keeping the original _ids so references between documents survive.
//   npm run db:copy -w api                            → report what would change
//   npm run db:copy -w api -- --write                 → apply it
//   FROM_DB=A TO_DB=B npm run db:copy -w api          → any other pair
import mongoose from 'mongoose';
import { resolveMongoUri } from '../src/env';

const FROM = process.env.FROM_DB || process.env.TEST_DB_NAME || 'HomeKitchenTest';
const TO = process.env.TO_DB || process.env.DB_NAME || 'HomeKitchen';
const write = process.argv.includes('--write');

(async () => {
  if (FROM === TO) { console.error(`refusing to copy "${FROM}" onto itself`); process.exit(2); }
  await mongoose.connect(resolveMongoUri(), { serverSelectionTimeoutMS: 15000 });
  const client = mongoose.connection.getClient();
  const src = client.db(FROM);
  const dst = client.db(TO);

  const names = (await src.collections()).map((c) => c.collectionName).sort();
  if (!names.length) { console.error(`"${FROM}" has no collections — nothing to copy`); process.exit(2); }

  console.log(`${write ? 'copying' : 'dry run:'} ${FROM} → ${TO}\n`);
  let written = 0;
  for (const name of names) {
    const docs = await src.collection(name).find().toArray();
    const before = await dst.collection(name).countDocuments();
    if (!docs.length) { console.log(`  ${name.padEnd(16)} source empty — leaving ${before} doc(s) in ${TO} alone`); continue; }
    console.log(`  ${name.padEnd(16)} ${String(docs.length).padStart(4)} doc(s)${before ? ` — replaces ${before} in ${TO}` : ''}`);
    if (!write) continue;
    await dst.collection(name).deleteMany({});
    await dst.collection(name).insertMany(docs);
    written += docs.length;
  }
  console.log(write ? `\nwrote ${written} document(s) into ${TO}` : `\nnothing written — re-run with --write to apply`);
  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
