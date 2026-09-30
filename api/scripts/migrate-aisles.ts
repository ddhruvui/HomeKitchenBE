// Renames the old aisles (Produce, Dry Goods, …) to the current ones on every ingredient and shopping-list item.
// Safe to run twice. Fruit that was filed under Produce lands in Veggies — move it by hand afterwards.
//   npm run migrate:aisles -w api                      → HomeKitchenTest
//   USE_TEST_DB=false npm run migrate:aisles -w api    → HomeKitchen (production)
import { connectDb, currentDbName, disconnectDb } from '../src/db';
import { IngredientModel, ShoppingListModel } from '../src/models';

const RENAME: Record<string, string> = { Produce: 'Veggies', 'Dry Goods': 'Grains', Bakery: 'Grains', Spices: 'Masala', Liquid: 'Canned', Condiments: 'Canned' };

(async () => {
  await connectDb();
  let ingredients = 0; let items = 0;
  for (const [from, to] of Object.entries(RENAME)) {
    ingredients += (await IngredientModel.collection.updateMany({ form: from }, { $set: { form: to } })).modifiedCount;
    items += (await ShoppingListModel.collection.updateMany({ 'items.group': from }, { $set: { 'items.$[i].group': to } }, { arrayFilters: [{ 'i.group': from }] })).modifiedCount;
  }
  console.log(`${currentDbName()}: ${ingredients} ingredient(s) and ${items} shopping list(s) updated`);
  await disconnectDb();
})().catch((e) => { console.error(e); process.exit(1); });
