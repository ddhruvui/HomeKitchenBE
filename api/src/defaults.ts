import { StoreModel } from './models';

/** The household's four stores, in the order they are visited (§5). Inserted when missing, never overwritten. */
export const DEFAULT_STORES = [
  { name: 'Costco', sortOrder: 0, color: '#4f8a5f' },
  { name: 'Indian Store', sortOrder: 1, color: '#b07d33' },
  { name: 'Walmart', sortOrder: 2, color: '#5b7cb8' },
  { name: 'ShopRite', sortOrder: 3, color: '#b96b62' },
];

/** Idempotent: adds any default store that does not exist by name and leaves existing ones exactly as they are. */
export async function ensureDefaultStores(): Promise<{ added: string[] }> {
  const added: string[] = [];
  for (const s of DEFAULT_STORES) {
    const r = await StoreModel.updateOne({ name: s.name }, { $setOnInsert: s }, { upsert: true });
    if (r.upsertedCount > 0) added.push(s.name);
  }
  return { added };
}
