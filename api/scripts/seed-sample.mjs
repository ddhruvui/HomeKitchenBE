// Seeds a small realistic week through the running API (default http://localhost:3000; override with API=…). Run reset-test-db first for a clean slate.
const B = process.env.API ?? 'http://localhost:3000';
const j = async (path, method = 'GET', body) => {
  const r = await fetch(B + path, { method, headers: { 'content-type': 'application/json' }, body: body && JSON.stringify(body) });
  const t = await r.text(); if (!r.ok) throw new Error(`${method} ${path} → ${r.status} ${t}`); return t ? JSON.parse(t) : null;
};
const stores = {};
for (const [name, color] of [['Costco', '#4f8a5f'], ['Indian Store', '#b07d33'], ['Walmart', '#5b7cb8'], ['ShopRite', '#b96b62']]) stores[name] = (await j('/api/stores', 'POST', { name, color })).id;
const ing = {};
const mk = async (b) => { ing[b.name] = (await j('/api/ingredients', 'POST', b)).id; };
await mk({ name: 'Yellow Onion', kind: 'fresh', storeId: stores.Costco, form: 'Produce', buyUnit: 'each', countUnit: 'each', ozPerCup: 5.6, ozPerCount: 5.3 });
await mk({ name: 'Tomato', kind: 'fresh', storeId: stores.Costco, form: 'Produce', buyUnit: 'lb', stockUnit: 'each', countUnit: 'each', ozPerCup: 6.3, ozPerCount: 5.3 });
await mk({ name: 'Potato', kind: 'fresh', storeId: stores.Costco, form: 'Produce', buyUnit: 'lb', ozPerCup: 7.4 });
await mk({ name: 'Paneer', kind: 'fresh', storeId: stores.Costco, form: 'Dairy', buyUnit: 'lb' });
await mk({ name: 'Pav', kind: 'fresh', storeId: stores.Costco, form: 'Bakery', buyUnit: 'each', countUnit: 'each' });
await mk({ name: 'Coriander', kind: 'fresh', storeId: stores['Indian Store'], form: 'Produce', buyUnit: 'bunch', countUnit: 'bunch', ozPerCount: 2.5 });
await mk({ name: 'Spinach', kind: 'fresh', storeId: stores.ShopRite, form: 'Produce', buyUnit: 'bunch', countUnit: 'bunch', ozPerCount: 6 });
await mk({ name: 'Green Peas', kind: 'fresh', storeId: stores.Walmart, form: 'Frozen', buyUnit: 'lb', ozPerCup: 5.1 });
await mk({ name: 'Milk', kind: 'weekly', storeId: stores.Costco, form: 'Dairy', weeklyQty: 2 });
await mk({ name: 'Eggs', kind: 'weekly', storeId: stores.Walmart, form: 'Dairy', weeklyQty: 1 });
for (const [name, store, form] of [['Basmati Rice', 'Indian Store', 'Dry Goods'], ['Toor Dal', 'Indian Store', 'Dry Goods'], ['Turmeric Powder', 'Indian Store', 'Spices'], ['Pav Bhaji Masala', 'Indian Store', 'Spices'], ['Ginger Garlic Paste', 'Indian Store', 'Spices'], ['Butter', 'Costco', 'Dairy'], ['Cooking Oil', 'Walmart', 'Liquid'], ['Salt', 'Walmart', 'Dry Goods']]) await mk({ name, kind: 'pantry', storeId: stores[store], form });
for (const n of ['Basmati Rice', 'Turmeric Powder', 'Pav Bhaji Masala']) await j(`/api/ingredients/${ing[n]}/low`, 'PATCH', { isLow: true });
const rec = {};
const R = async (title, lines, steps) => { rec[title] = (await j('/api/recipes', 'POST', { title, tags: ['veg'], steps, ingredients: lines.map(([n, qty, unit, note]) => ({ ingredientId: ing[n], ...(qty ? { qty, unit } : {}), ...(note ? { note } : {}) })) })).id; };
await R('Pav Bhaji', [['Potato', 2, 'cup', 'boiled and mashed'], ['Yellow Onion', 1, 'cup', 'finely chopped'], ['Tomato', 1.5, 'cup', 'chopped'], ['Green Peas', 0.5, 'cup'], ['Butter', 3, 'tbsp'], ['Pav', 8, 'each'], ['Pav Bhaji Masala', 2, 'tbsp'], ['Ginger Garlic Paste', 1, 'tbsp'], ['Coriander', 0.5, 'cup', 'to finish']],
  ['Boil the potatoes until soft, then mash them roughly.', 'Finely chop the onion and tomato.', 'Melt the butter in a wide pan and fry the onion until golden.', 'Stir in the ginger garlic paste and pav bhaji masala; cook one minute.', 'Add the tomato and cook until the oil separates.', 'Fold in the potato and peas with a cup of water. Mash and simmer ten minutes.', 'Toast the pav in butter. Finish the bhaji with chopped coriander.']);
await R('Palak Paneer', [['Spinach', 2, 'bunch'], ['Paneer', 8, 'oz', 'cubed'], ['Yellow Onion', 1, 'each', 'chopped'], ['Tomato', 2, 'each', 'chopped'], ['Ginger Garlic Paste', 1, 'tbsp'], ['Butter', 2, 'tbsp']],
  ['Blanch the spinach two minutes, shock in cold water, blend smooth.', 'Fry the onion in butter; add ginger garlic paste, then tomato until soft.', 'Stir in the spinach; simmer five minutes.', 'Fold in the paneer and warm through.']);
await R('Poha', [['Yellow Onion', 1, 'each', 'chopped'], ['Potato', 1, 'cup', 'diced small'], ['Turmeric Powder', 0.5, 'tsp']], ['Rinse the poha and let it drain.', 'Cook onion and potato until soft; add turmeric and the poha.']);
await R('Khichdi', [['Basmati Rice', 1, 'cup'], ['Toor Dal', 0.5, 'cup'], ['Turmeric Powder', 1, 'tsp']], ['Rinse the rice and dal together.', 'Pressure-cook with turmeric, salt and water for three whistles.']);
await j('/api/plan/2026-09-04', 'PUT', { dinner: [rec['Khichdi']] });
await j('/api/plan/2026-09-05', 'PUT', { breakfast: [rec['Poha']], dinner: [rec['Pav Bhaji']] });
await j('/api/plan/2026-09-06', 'PUT', { dinner: [rec['Palak Paneer']] });
await j('/api/plan/2026-09-08', 'PUT', { breakfast: [rec['Poha']], dinner: [rec['Pav Bhaji'], rec['Khichdi']] });
await j('/api/fresh-stock', 'PUT', [{ ingredientId: ing['Yellow Onion'], qty: 3, unit: 'each' }, { ingredientId: ing['Tomato'], qty: 4, unit: 'each' }]);
console.log('seeded:', Object.keys(stores).length, 'stores,', Object.keys(ing).length, 'ingredients,', Object.keys(rec).length, 'recipes; week of 2026-09-05 planned');
