import request from 'supertest';
import { buildApp } from '../app';
import { clearTestDb, closeTestDb, openTestDb } from './testDb';

const app = buildApp();
beforeAll(openTestDb); beforeEach(clearTestDb); afterAll(closeTestDb);

async function seed() {
  const s = (await request(app).post('/api/stores').send({ name: 'Costco' })).body;
  const onion = (await request(app).post('/api/ingredients').send({ name: 'Onion', kind: 'fresh', storeId: s.id, form: 'Produce', buyUnit: 'each', countUnit: 'each' })).body;
  const cor = (await request(app).post('/api/ingredients').send({ name: 'Coriander', kind: 'fresh', storeId: s.id, form: 'Produce', buyUnit: 'bunch', countUnit: 'bunch' })).body;
  const masala = (await request(app).post('/api/ingredients').send({ name: 'Masala', kind: 'pantry', storeId: s.id, form: 'Spices' })).body;
  return { s, onion, cor, masala };
}

describe('recipes', () => {
  test('saves lines, steps and tags; pantry lines keep their amount', async () => {
    const { onion, masala } = await seed();
    const r = await request(app).post('/api/recipes').send({
      title: 'Pav Bhaji', tags: ['veg'], steps: ['Boil the potatoes.', 'Mash.'],
      ingredients: [{ ingredientId: onion.id, qty: 1, unit: 'cup', note: 'chopped' }, { ingredientId: masala.id, qty: 2, unit: 'tbsp' }],
    });
    expect(r.status).toBe(201);
    expect(r.body.steps).toHaveLength(2);
    expect(r.body.ingredients[1]).toMatchObject({ qty: 2, unit: 'tbsp' });
  });
  test('a count unit that is not the ingredient\'s own is rejected at save time', async () => {
    const { onion, cor } = await seed();
    const r = await request(app).post('/api/recipes').send({ title: 'Bad', ingredients: [{ ingredientId: onion.id, qty: 2, unit: 'bunch' }, { ingredientId: cor.id, qty: 0.5, unit: 'bunch' }] });
    expect(r.status).toBe(400);
    expect(JSON.stringify(r.body.details)).toMatch(/counted in each/);
  });
  test('unknown ingredient id is rejected', async () => {
    await seed();
    const r = await request(app).post('/api/recipes').send({ title: 'X', ingredients: [{ ingredientId: '000000000000000000000000', qty: 1, unit: 'cup' }] });
    expect(r.status).toBe(400);
  });
  test('a planned recipe cannot be deleted', async () => {
    const { onion } = await seed();
    const rec = (await request(app).post('/api/recipes').send({ title: 'Poha', ingredients: [{ ingredientId: onion.id, qty: 1, unit: 'each' }] })).body;
    await request(app).put('/api/plan/2026-09-05').send({ breakfast: [rec.id], dinner: [] }).expect(200);
    expect((await request(app).delete(`/api/recipes/${rec.id}`)).status).toBe(409);
  });
});
