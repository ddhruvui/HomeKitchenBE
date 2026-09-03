import request from 'supertest';
import { buildApp } from '../app';
import { clearTestDb, closeTestDb, openTestDb } from './testDb';

const app = buildApp();
beforeAll(openTestDb); beforeEach(clearTestDb); afterAll(closeTestDb);

async function seed() {
  const costco = (await request(app).post('/api/stores').send({ name: 'Costco', sortOrder: 0 })).body;
  const indian = (await request(app).post('/api/stores').send({ name: 'Indian Store', sortOrder: 1 })).body;
  const mk = async (b: Record<string, unknown>) => (await request(app).post('/api/ingredients').send(b)).body;
  const onion = await mk({ name: 'Yellow Onion', kind: 'fresh', storeId: costco.id, form: 'Produce', buyUnit: 'each', countUnit: 'each', ozPerCup: 5.6, ozPerCount: 5.3 });
  const paneer = await mk({ name: 'Paneer', kind: 'fresh', storeId: costco.id, form: 'Dairy', buyUnit: 'lb' });
  const milk = await mk({ name: 'Milk', kind: 'weekly', storeId: costco.id, form: 'Dairy', weeklyQty: 2 });
  const rice = await mk({ name: 'Basmati Rice', kind: 'pantry', storeId: indian.id, form: 'Dry Goods' });
  const spinach = await mk({ name: 'Spinach', kind: 'fresh', storeId: indian.id, form: 'Produce', buyUnit: 'bunch', countUnit: 'bunch' });
  const pav = (await request(app).post('/api/recipes').send({ title: 'Pav Bhaji', ingredients: [{ ingredientId: onion.id, qty: 1, unit: 'cup' }, { ingredientId: rice.id, qty: 1, unit: 'cup' }] })).body;
  const palak = (await request(app).post('/api/recipes').send({ title: 'Palak Paneer', ingredients: [{ ingredientId: paneer.id, qty: 8, unit: 'oz' }, { ingredientId: spinach.id, qty: 1, unit: 'cup' }] })).body;
  await request(app).put('/api/plan/2026-09-05').send({ dinner: [pav.id] });
  await request(app).put('/api/plan/2026-09-06').send({ dinner: [palak.id] });
  return { costco, indian, onion, paneer, milk, rice, spinach, pav, palak };
}
type Item = { ingredientId: string; source: string; checked: boolean; buyQty?: number; buyUnit?: string; group: string; storeId: string; name: string };
const find = (items: Item[], id: string) => items.find((i) => i.ingredientId === id);

describe('fresh stock', () => {
  test('needed lists only the fresh ingredients the week uses, with any stock already entered', async () => {
    const { onion, paneer, spinach } = await seed();
    await request(app).put('/api/fresh-stock').send([{ ingredientId: onion.id, qty: 3, unit: 'each' }]).expect(200);
    const r = (await request(app).get('/api/fresh-stock/needed?date=2026-09-07')).body;
    expect(r).toMatchObject({ startDate: '2026-09-05', endDate: '2026-09-11', people: 2 });
    type Row = { ingredient: { id: string }; stock: unknown; needQty: number | null; needUnit: string | null; problem: string | null };
    const rows: Row[] = r.items;
    expect(rows.map((x) => x.ingredient.id).sort()).toEqual([onion.id, paneer.id, spinach.id].sort());
    const o = rows.find((x) => x.ingredient.id === onion.id)!;
    expect(o.stock).toEqual({ qty: 3, unit: 'each' });
    expect(o.needUnit).toBe('each'); expect(o.needQty).toBeCloseTo(11.2 / 5.3, 1); // 1 cup ×2 for dinner, in onions
    expect(rows.find((x) => x.ingredient.id === paneer.id)).toMatchObject({ needQty: 1, needUnit: 'lb', problem: null });
    const sp = rows.find((x) => x.ingredient.id === spinach.id)!;
    expect(sp.needQty).toBeNull(); expect(sp.problem).toMatch(/ozPerCup/);
  });
  test('the kitchen check also names the pantry items this week cooks with', async () => {
    const { rice } = await seed();
    const r = (await request(app).get('/api/fresh-stock/needed?date=2026-09-07')).body;
    expect(r.pantry).toEqual([{ ingredient: expect.objectContaining({ id: rice.id, name: 'Basmati Rice' }), isLow: false }]);
  });
  test('rejects stock for a pantry ingredient', async () => {
    const { rice } = await seed();
    await request(app).put('/api/fresh-stock').send([{ ingredientId: rice.id, qty: 1, unit: 'lb' }]).expect(400);
  });
});

describe('generate', () => {
  test('one list for the week: fresh shortfalls, weekly, running low; problems reported not dropped', async () => {
    const { onion, paneer, milk, rice, spinach } = await seed();
    await request(app).patch(`/api/ingredients/${rice.id}/low`).send({ isLow: true });
    await request(app).put('/api/fresh-stock').send([{ ingredientId: onion.id, qty: 1, unit: 'each' }]);
    const r = await request(app).post('/api/lists/generate').send({ date: '2026-09-09' });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ startDate: '2026-09-05', endDate: '2026-09-11', people: 2 });
    const items: Item[] = r.body.items;
    // onion: 1 cup ×2 (dinner) = 11.2 oz, have 5.3 → short 5.9 oz = 1.11 each
    expect(find(items, onion.id)).toMatchObject({ source: 'auto', buyUnit: 'each' });
    expect(find(items, onion.id)!.buyQty).toBeCloseTo(1.11, 1);
    expect(find(items, paneer.id)).toMatchObject({ buyQty: 1, buyUnit: 'lb' });
    expect(find(items, milk.id)).toMatchObject({ source: 'weekly', buyQty: 2 });
    expect(find(items, rice.id)).toMatchObject({ source: 'low', group: 'Running low' });
    expect(find(items, spinach.id)).toBeUndefined();
    expect(r.body.problems).toEqual([expect.objectContaining({ ingredientId: spinach.id, reason: expect.stringContaining('ozPerCup') })]);
    expect(items[0].storeId).toBe(find(items, onion.id)!.storeId);
    expect((await request(app).get('/api/lists?date=2026-09-11')).body.id).toBe(r.body.id);
  });

  test('ticking keeps the line, and for a running-low item marks the ingredient replenished', async () => {
    const { rice, onion } = await seed();
    await request(app).patch(`/api/ingredients/${rice.id}/low`).send({ isLow: true });
    const list = (await request(app).post('/api/lists/generate').send({ date: '2026-09-05' })).body;
    const after = (await request(app).patch(`/api/lists/${list.id}/items/${rice.id}`).send({ checked: true })).body;
    expect(find(after.items, rice.id)).toMatchObject({ checked: true, source: 'low' });
    expect((await request(app).get(`/api/ingredients?low=true`)).body).toEqual([]);
    const un = (await request(app).patch(`/api/lists/${list.id}/items/${rice.id}`).send({ checked: false })).body;
    expect(find(un.items, rice.id)!.checked).toBe(false);
    expect((await request(app).get(`/api/ingredients?low=true`)).body).toHaveLength(1);
    await request(app).patch(`/api/lists/${list.id}/items/${onion.id}`).send({ checked: true }).expect(200);
  });

  test('regenerating merges: ticks survive, dropped items go, manual items stay', async () => {
    const { onion, palak, costco } = await seed();
    const list = (await request(app).post('/api/lists/generate').send({ date: '2026-09-05' })).body;
    await request(app).patch(`/api/lists/${list.id}/items/${onion.id}`).send({ checked: true });
    await request(app).post(`/api/lists/${list.id}/items`).send({ name: 'Birthday candles', storeId: costco.id }).expect(201);
    await request(app).put('/api/plan/2026-09-06').send({ dinner: [] }); // drop palak paneer → no paneer needed
    const again = await request(app).post('/api/lists/generate').send({ date: '2026-09-05' });
    expect(again.status).toBe(200);
    const items: Item[] = again.body.items;
    expect(find(items, onion.id)!.checked).toBe(true);
    expect(items.find((i) => i.name === 'Paneer')).toBeUndefined();
    expect(items.find((i) => i.source === 'manual')!.name).toBe('Birthday candles');
    expect((await request(app).get('/api/lists')).body).toHaveLength(1);
    void palak;
  });

  test('the list carries a check-the-pantry reminder, and flagging from it adds the item to the store on the spot', async () => {
    const { rice, indian } = await seed();
    const list = (await request(app).post('/api/lists/generate').send({ date: '2026-09-05' })).body;
    expect(list.pantryCheck).toEqual([{ ingredientId: rice.id, name: 'Basmati Rice', storeId: indian.id, isLow: false }]);
    expect(find(list.items, rice.id)).toBeUndefined();
    const after = (await request(app).patch(`/api/lists/${list.id}/pantry/${rice.id}`).send({ isLow: true })).body;
    expect(find(after.items, rice.id)).toMatchObject({ source: 'low', group: 'Running low', storeId: indian.id, checked: false });
    expect(after.pantryCheck[0].isLow).toBe(true);
    expect((await request(app).get('/api/ingredients?low=true')).body.map((i: { id: string }) => i.id)).toEqual([rice.id]);
    const undone = (await request(app).patch(`/api/lists/${list.id}/pantry/${rice.id}`).send({ isLow: false })).body;
    expect(find(undone.items, rice.id)).toBeUndefined();
    expect((await request(app).get('/api/ingredients?low=true')).body).toEqual([]);
  });

  test('next week is a separate list', async () => {
    await seed();
    const a = (await request(app).post('/api/lists/generate').send({ date: '2026-09-05' })).body;
    const b = (await request(app).post('/api/lists/generate').send({ date: '2026-09-12' })).body;
    expect(a.id).not.toBe(b.id);
    expect(b.items.filter((i: Item) => i.source === 'auto')).toEqual([]);
    expect((await request(app).get('/api/lists')).body).toHaveLength(2);
  });
});
