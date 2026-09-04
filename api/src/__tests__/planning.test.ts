import request from 'supertest';
import { buildApp } from '../app';
import { clearTestDb, closeTestDb, openTestDb } from './testDb';

const app = buildApp();
beforeAll(openTestDb); beforeEach(clearTestDb); afterAll(closeTestDb);

async function seed() {
  const s = (await request(app).post('/api/stores').send({ name: 'Costco' })).body;
  const onion = (await request(app).post('/api/ingredients').send({ name: 'Onion', kind: 'fresh', storeId: s.id, form: 'Produce', buyUnit: 'each', countUnit: 'each', ozPerCup: 5.6, ozPerCount: 5.3 })).body;
  const pav = (await request(app).post('/api/recipes').send({ title: 'Pav Bhaji', steps: ['Boil.'], ingredients: [{ ingredientId: onion.id, qty: 1, unit: 'cup' }] })).body;
  const poha = (await request(app).post('/api/recipes').send({ title: 'Poha', ingredients: [{ ingredientId: onion.id, qty: 1, unit: 'each' }] })).body;
  const kadhi = (await request(app).post('/api/recipes').send({ title: 'Kadhi', ingredients: [] })).body;
  return { onion, pav, poha, kadhi };
}

describe('plan', () => {
  test('a week is seven days starting Saturday, and lunch is yesterday\'s dinner, across the week boundary', async () => {
    const { pav, poha } = await seed();
    await request(app).put('/api/plan/2026-09-04').send({ dinner: [pav.id] }).expect(200); // Friday of the previous week
    await request(app).put('/api/plan/2026-09-05').send({ breakfast: [poha.id], dinner: [pav.id] }).expect(200);
    const w = (await request(app).get('/api/plan/week?date=2026-09-09')).body; // a Wednesday
    expect(w.startDate).toBe('2026-09-05'); expect(w.endDate).toBe('2026-09-11'); expect(w.days).toHaveLength(7);
    expect(w.days[0].lunch).toEqual([{ id: pav.id, title: 'Pav Bhaji' }]);
    expect(w.days[1].lunch[0].title).toBe('Pav Bhaji');
    expect(w.days[2].lunch).toEqual([]);
    // with nothing marked, every day is an ordinary one: cooked on the day, lunch from the evening before
    expect(w.days[0]).toMatchObject({ isEkadashi: false, lunchFrom: '2026-09-04', dinnerCookedOn: '2026-09-05', cookAhead: null });
    expect(w.days[2]).toMatchObject({ lunchFrom: null, dinnerCookedOn: '2026-09-07' });
  });
  test('several dishes in one slot', async () => {
    const { pav, kadhi } = await seed();
    const r = await request(app).put('/api/plan/2026-09-11').send({ dinner: [pav.id, kadhi.id] });
    expect(r.body.dinner).toHaveLength(2);
  });
  test('rejects a recipe that does not exist and a bad date', async () => {
    await seed();
    await request(app).put('/api/plan/2026-09-05').send({ dinner: ['000000000000000000000000'] }).expect(400);
    await request(app).put('/api/plan/2026-13-05').send({ dinner: [] }).expect(400);
  });
  test('copy last week fills the target week', async () => {
    const { pav, poha } = await seed();
    await request(app).put('/api/plan/2026-09-05').send({ breakfast: [poha.id], dinner: [pav.id] });
    await request(app).put('/api/plan/2026-09-08').send({ dinner: [pav.id] });
    const r = await request(app).post('/api/plan/copy').send({ fromDate: '2026-09-07', toDate: '2026-09-15' });
    expect(r.body).toMatchObject({ from: '2026-09-05', to: '2026-09-12', daysCopied: 2 });
    const w = (await request(app).get('/api/plan/week?date=2026-09-12')).body;
    expect(w.days[0].dinner[0].title).toBe('Pav Bhaji');
    expect(w.days[3].dinner[0].title).toBe('Pav Bhaji');
  });
});

describe('today', () => {
  test('breakfast ×1, dinner ×2, scaled by household, with steps and lunch', async () => {
    const { pav, poha } = await seed();
    await request(app).put('/api/plan/2026-09-05').send({ dinner: [pav.id] });
    await request(app).put('/api/plan/2026-09-06').send({ breakfast: [poha.id], dinner: [pav.id] });
    const t = (await request(app).get('/api/today?date=2026-09-06')).body;
    expect(t.breakfast[0].lines[0]).toMatchObject({ name: 'Onion', qty: 1, unit: 'each' });
    expect(t.dinner[0].lines[0]).toMatchObject({ name: 'Onion', qty: 2, unit: 'cup' });
    expect(t.dinner[0].steps).toEqual(['Boil.']);
    expect(t.lunch).toEqual(['Pav Bhaji']);
    expect(t).toMatchObject({ isEkadashi: false, lunchFrom: '2026-09-05', dinnerCookedOn: '2026-09-06', cookAhead: null });
    await request(app).put('/api/settings').send({ people: 4 });
    const t4 = (await request(app).get('/api/today?date=2026-09-06')).body;
    expect(t4.breakfast[0].lines[0].qty).toBe(2); expect(t4.dinner[0].lines[0].qty).toBe(4);
  });
});
