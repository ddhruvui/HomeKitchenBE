import request from 'supertest';
import { buildApp } from '../app';
import { clearTestDb, closeTestDb, openTestDb } from './testDb';

const app = buildApp();
beforeAll(openTestDb); beforeEach(clearTestDb); afterAll(closeTestDb);

async function store(name = 'Costco') { return (await request(app).post('/api/stores').send({ name, color: '#4f8a5f' })).body; }

describe('health', () => {
  test('reports the test database', async () => {
    const r = await request(app).get('/api/health');
    expect(r.status).toBe(200); expect(r.body.db).toMatch(/Test$/);
  });
});

describe('stores', () => {
  test('create, list in visit order, update, delete', async () => {
    const a = await store('Walmart'); const b = await store('Costco');
    expect(a.sortOrder).toBe(0); expect(b.sortOrder).toBe(1);
    await request(app).put(`/api/stores/${b.id}`).send({ sortOrder: -1 }).expect(200);
    const list = (await request(app).get('/api/stores')).body;
    expect(list.map((s: { name: string }) => s.name)).toEqual(['Costco', 'Walmart']);
    await request(app).delete(`/api/stores/${a.id}`).expect(204);
  });
  test('a store with ingredients cannot be deleted', async () => {
    const s = await store();
    await request(app).post('/api/ingredients').send({ name: 'Salt', kind: 'pantry', storeId: s.id, form: 'Dry Goods' }).expect(201);
    const r = await request(app).delete(`/api/stores/${s.id}`);
    expect(r.status).toBe(409);
  });
});

describe('settings', () => {
  test('defaults to two people and a Saturday week', async () => {
    const r = await request(app).get('/api/settings');
    expect(r.body).toMatchObject({ people: 2, weekStartsOn: 6 });
  });
  test('household count is one setting', async () => {
    await request(app).put('/api/settings').send({ people: 4 }).expect(200);
    expect((await request(app).get('/api/settings')).body.people).toBe(4);
    await request(app).put('/api/settings').send({ people: 0 }).expect(400);
  });
});

describe('ingredients', () => {
  test('fresh needs a buy unit, weekly needs a quantity, pantry needs neither', async () => {
    const s = await store();
    await request(app).post('/api/ingredients').send({ name: 'Onion', kind: 'fresh', storeId: s.id, form: 'Produce' }).expect(400);
    await request(app).post('/api/ingredients').send({ name: 'Milk', kind: 'weekly', storeId: s.id, form: 'Dairy' }).expect(400);
    const rice = (await request(app).post('/api/ingredients').send({ name: 'Rice', kind: 'pantry', storeId: s.id, form: 'Dry Goods', buyUnit: 'lb' })).body;
    expect(rice.buyUnit).toBeUndefined();
    expect(rice.isLow).toBe(false);
  });
  test('names are unique regardless of case', async () => {
    const s = await store();
    await request(app).post('/api/ingredients').send({ name: 'Yellow Onion', kind: 'fresh', storeId: s.id, form: 'Produce', buyUnit: 'each', countUnit: 'each' }).expect(201);
    const r = await request(app).post('/api/ingredients').send({ name: 'yellow onion', kind: 'fresh', storeId: s.id, form: 'Produce', buyUnit: 'each' });
    expect(r.status).toBe(409);
  });
  test('stockUnit defaults to buyUnit', async () => {
    const s = await store();
    const r = await request(app).post('/api/ingredients').send({ name: 'Paneer', kind: 'fresh', storeId: s.id, form: 'Dairy', buyUnit: 'lb' });
    expect(r.body.stockUnit).toBe('lb');
  });
  test('only pantry items can be marked low, and it round-trips', async () => {
    const s = await store();
    const rice = (await request(app).post('/api/ingredients').send({ name: 'Rice', kind: 'pantry', storeId: s.id, form: 'Dry Goods' })).body;
    const onion = (await request(app).post('/api/ingredients').send({ name: 'Onion', kind: 'fresh', storeId: s.id, form: 'Produce', buyUnit: 'each' })).body;
    expect((await request(app).patch(`/api/ingredients/${rice.id}/low`).send({ isLow: true })).body.isLow).toBe(true);
    expect((await request(app).get('/api/ingredients?low=true')).body).toHaveLength(1);
    await request(app).patch(`/api/ingredients/${onion.id}/low`).send({ isLow: true }).expect(400);
  });
  test('a pantry item may carry an expiry date, optional, and the expiring view sorts soonest first', async () => {
    const s = await store();
    const mk = (name: string, expiresOn?: string) => request(app).post('/api/ingredients').send({ name, kind: 'pantry', storeId: s.id, form: 'Spices', ...(expiresOn ? { expiresOn } : {}) });
    const masala = (await mk('Pav Bhaji Masala', '2026-12-01')).body;
    await mk('Turmeric Powder', '2026-09-15').expect(201);
    await mk('Salt').expect(201);
    expect(masala.expiresOn).toBe('2026-12-01');
    const expiring = (await request(app).get('/api/ingredients?expiring=true')).body;
    expect(expiring.map((i: { name: string }) => i.name)).toEqual(['Turmeric Powder', 'Pav Bhaji Masala']);
    const cleared = (await request(app).put(`/api/ingredients/${masala.id}`).send({ expiresOn: null })).body;
    expect(cleared.expiresOn).toBeUndefined();
    await mk('Bad', '2026-13-40').expect(400);
    await request(app).post('/api/ingredients').send({ name: 'Onion', kind: 'fresh', storeId: s.id, form: 'Produce', buyUnit: 'each', expiresOn: '2026-10-01' }).expect(400);
  });
  test('an ingredient used by a recipe cannot be deleted', async () => {
    const s = await store();
    const onion = (await request(app).post('/api/ingredients').send({ name: 'Onion', kind: 'fresh', storeId: s.id, form: 'Produce', buyUnit: 'each', countUnit: 'each' })).body;
    await request(app).post('/api/recipes').send({ title: 'Poha', ingredients: [{ ingredientId: onion.id, qty: 1, unit: 'each' }] }).expect(201);
    expect((await request(app).delete(`/api/ingredients/${onion.id}`)).status).toBe(409);
  });
  test('needs-bridge lists what recipes cannot yet convert, and confirming a bridge clears it', async () => {
    const s = await store();
    const onion = (await request(app).post('/api/ingredients').send({ name: 'Onion', kind: 'fresh', storeId: s.id, form: 'Produce', buyUnit: 'each', countUnit: 'each', ozPerCount: 5.3 })).body;
    await request(app).post('/api/recipes').send({ title: 'Pav Bhaji', ingredients: [{ ingredientId: onion.id, qty: 1, unit: 'cup' }] }).expect(201);
    const before = (await request(app).get('/api/ingredients/needs-bridge')).body;
    expect(before).toEqual([expect.objectContaining({ needs: ['ozPerCup'], units: ['cup'] })]);
    await request(app).patch(`/api/ingredients/${onion.id}/bridges`).send({ ozPerCup: 5.6 }).expect(200);
    expect((await request(app).get('/api/ingredients/needs-bridge')).body).toEqual([]);
  });
});
