import request from 'supertest';
import { buildApp } from '../app';
import { clearTestDb, closeTestDb, openTestDb } from './testDb';

const app = buildApp();
beforeAll(openTestDb); beforeEach(clearTestDb); afterAll(closeTestDb);

// The user's own worked example (§4): the week starts Saturday 2026-09-05, so Mon/Tue/Wed are days 2/3/4.
const [SAT, MON, TUE, WED, THU] = ['2026-09-05', '2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10'];
const FRI = '2026-09-04'; // the last evening of the previous week

type Day = { id: string; date: string; name?: string };
type Ref = { id: string; title: string | null };
type Item = { ingredientId: string; buyQty?: number; buyUnit?: string; source: string };
const dates = (body: Day[]) => body.map((d) => d.date);
const mark = (date: string, body: Record<string, unknown> = {}) => request(app).put(`/api/ekadashi/${date}`).send(body);

async function seed() {
  const store = (await request(app).post('/api/stores').send({ name: 'Costco' })).body;
  const mkIng = async (b: Record<string, unknown>) => (await request(app).post('/api/ingredients').send({ storeId: store.id, ...b })).body;
  const potato = await mkIng({ name: 'Potato', kind: 'fresh', form: 'Produce', buyUnit: 'lb' });
  const paneer = await mkIng({ name: 'Paneer', kind: 'fresh', form: 'Dairy', buyUnit: 'lb' });
  const mkRec = async (title: string, ingredients: unknown[]) => (await request(app).post('/api/recipes').send({ title, ingredients })).body;
  const palak = await mkRec('Palak Paneer', [{ ingredientId: paneer.id, qty: 8, unit: 'oz' }]);
  const bateta = await mkRec('Bateta Bhaji', [{ ingredientId: potato.id, qty: 4, unit: 'oz' }]);
  const khichdi = await mkRec('Khichdi', []);
  const sabudana = await mkRec('Sabudana Khichdi', []);
  return { potato, paneer, palak, bateta, khichdi, sabudana };
}

describe('marking fast days', () => {
  test('mark, re-mark, rename, clear the name, and unmark twice', async () => {
    const first = await mark(TUE, { name: '  Parivartini  ' }).expect(200);
    expect(first.body).toMatchObject({ date: TUE, name: 'Parivartini' });
    const again = await mark(TUE).expect(200); // marking an already-marked date is not an error
    expect(again.body).toMatchObject({ id: first.body.id, name: 'Parivartini' }); // and leaves the name alone
    expect((await mark(TUE, { name: 'Indira' })).body.name).toBe('Indira');
    expect((await mark(TUE, { name: '' })).body.name).toBeUndefined(); // an empty name takes the name back off
    expect((await mark(TUE, { name: 'Indira' })).body.name).toBe('Indira');
    expect((await mark(TUE, { name: null })).body.name).toBeUndefined(); // and so does a null one
    expect((await request(app).get('/api/ekadashi')).body).toHaveLength(1);
    await request(app).delete(`/api/ekadashi/${TUE}`).expect(204);
    await request(app).delete(`/api/ekadashi/${TUE}`).expect(204); // unmarking an unmarked date is the same outcome
    expect((await request(app).get('/api/ekadashi')).body).toEqual([]);
  });

  test('the from/to window, ascending', async () => {
    for (const d of [SAT, TUE, '2026-09-20']) await mark(d).expect(200);
    expect(dates((await request(app).get('/api/ekadashi')).body)).toEqual([SAT, TUE, '2026-09-20']);
    expect(dates((await request(app).get('/api/ekadashi?from=2026-09-06&to=2026-09-30')).body)).toEqual([TUE, '2026-09-20']);
    expect(dates((await request(app).get(`/api/ekadashi?to=${SAT}`)).body)).toEqual([SAT]);
  });

  test('bad dates and an over-long name are 400', async () => {
    await mark('2026-09-31').expect(400);
    await mark('not-a-date').expect(400);
    await mark(TUE, { name: 'x'.repeat(61) }).expect(400);
    await request(app).delete('/api/ekadashi/2026-13-01').expect(400);
    await request(app).get('/api/ekadashi?from=2026-13-01').expect(400);
    await request(app).get('/api/ekadashi?to=nope').expect(400);
  });
});

describe('the fast day in the plan', () => {
  test('the worked example: Tuesday is cooked Monday evening and Wednesday still eats Monday', async () => {
    const { palak, bateta, khichdi, sabudana } = await seed();
    await request(app).put(`/api/plan/${MON}`).send({ dinner: [palak.id] }).expect(200);
    await request(app).put(`/api/plan/${TUE}`).send({ breakfast: [sabudana.id], dinner: [bateta.id] }).expect(200);
    await request(app).put(`/api/plan/${WED}`).send({ dinner: [khichdi.id] }).expect(200);
    await mark(TUE, { name: 'Parivartini' }).expect(200);

    const w = (await request(app).get(`/api/plan/week?date=${WED}`)).body;
    const [mon, tue, wed] = [w.days[2], w.days[3], w.days[4]];
    expect(mon).toMatchObject({ date: MON, isEkadashi: false, dinnerCookedOn: MON });
    expect(mon.cookAhead).toEqual({ date: TUE, dishes: [{ id: bateta.id, title: 'Bateta Bhaji' }] });
    expect(tue).toMatchObject({ date: TUE, isEkadashi: true, dinnerCookedOn: MON, lunchFrom: MON, cookAhead: null });
    expect(tue.lunch).toEqual(tue.dinner); // one dish, both meals
    expect(tue.lunch).toEqual([{ id: bateta.id, title: 'Bateta Bhaji' }]);
    expect(tue.breakfast).toEqual([{ id: sabudana.id, title: 'Sabudana Khichdi' }]); // a fast keeps its breakfast slot
    expect(wed).toMatchObject({ date: WED, isEkadashi: false, lunchFrom: MON, dinnerCookedOn: WED });
    expect(wed.lunch).toEqual([{ id: palak.id, title: 'Palak Paneer' }]); // Monday's dinner jumped over the fast

    const t = (await request(app).get(`/api/today?date=${TUE}`)).body;
    expect(t).toMatchObject({ isEkadashi: true, dinnerCookedOn: MON, lunchFrom: MON, cookAhead: null, lunch: ['Bateta Bhaji'] });
    expect(t.dinner[0]).toMatchObject({ title: 'Bateta Bhaji', factor: 2 }); // still a ×2 dinner slot
    expect(t.breakfast[0]).toMatchObject({ title: 'Sabudana Khichdi', factor: 1 });
    const tm = (await request(app).get(`/api/today?date=${MON}`)).body;
    expect(tm.cookAhead.date).toBe(TUE);
    expect(tm.cookAhead.recipes[0]).toMatchObject({ title: 'Bateta Bhaji', factor: 2 });
    const tw = (await request(app).get(`/api/today?date=${WED}`)).body;
    expect(tw).toMatchObject({ isEkadashi: false, lunch: ['Palak Paneer'], lunchFrom: MON });
  });

  test('a fast on the first day of a week is cooked on the previous week\'s last evening', async () => {
    const { palak, bateta } = await seed();
    await request(app).put(`/api/plan/${FRI}`).send({ dinner: [palak.id] }).expect(200);
    await request(app).put(`/api/plan/${SAT}`).send({ dinner: [bateta.id] }).expect(200);
    await mark(SAT).expect(200);
    const w = (await request(app).get(`/api/plan/week?date=${SAT}`)).body;
    expect(w.startDate).toBe(SAT);
    expect(w.days[0]).toMatchObject({ isEkadashi: true, dinnerCookedOn: FRI, lunchFrom: FRI });
    expect(w.days[0].lunch).toEqual([{ id: bateta.id, title: 'Bateta Bhaji' }]);
    expect(w.days[1]).toMatchObject({ lunchFrom: FRI }); // Friday's dinner carries past the fast into Sunday
    expect(w.days[1].lunch).toEqual([{ id: palak.id, title: 'Palak Paneer' }]);
    const prev = (await request(app).get(`/api/plan/week?date=${FRI}`)).body;
    expect(prev.endDate).toBe(FRI);
    expect(prev.days[6].cookAhead).toEqual({ date: SAT, dishes: [{ id: bateta.id, title: 'Bateta Bhaji' }] }); // one day past the week's end, deliberately
  });

  test('two fasts in a row each eat their own dish and the carry reaches back past both', async () => {
    const { palak, bateta, khichdi } = await seed();
    await request(app).put(`/api/plan/${MON}`).send({ dinner: [palak.id] }).expect(200);
    for (const d of [TUE, WED]) await request(app).put(`/api/plan/${d}`).send({ dinner: [bateta.id] }).expect(200);
    await request(app).put(`/api/plan/${THU}`).send({ dinner: [khichdi.id] }).expect(200);
    for (const d of [TUE, WED]) await mark(d).expect(200);
    const w = (await request(app).get(`/api/plan/week?date=${WED}`)).body;
    expect(w.days[3]).toMatchObject({ isEkadashi: true, dinnerCookedOn: MON, lunchFrom: MON });
    expect(w.days[4]).toMatchObject({ isEkadashi: true, dinnerCookedOn: TUE, lunchFrom: TUE });
    expect(w.days[2].cookAhead.date).toBe(TUE); // Monday cooks the first fast's dish
    expect(w.days[3].cookAhead.date).toBe(WED); // and the first fast's evening cooks the second's
    expect(w.days[5]).toMatchObject({ lunchFrom: MON });
    expect((w.days[5].lunch as Ref[]).map((r) => r.title)).toEqual(['Palak Paneer']); // Thursday still eats Monday's dinner
  });
});

// The load-bearing claim of the whole design (§4/§5): the fast dish rides in the existing ×2 dinner
// slot, so generation never learns about fasts and the week's totals cannot move.
test('marking a day Ekadashi does not change a thing about what the week buys', async () => {
  const { palak, bateta, paneer, potato } = await seed();
  await request(app).put(`/api/plan/${MON}`).send({ dinner: [palak.id] }).expect(200);
  await request(app).put(`/api/plan/${TUE}`).send({ dinner: [bateta.id] }).expect(200);
  const totals = (items: Item[]) => items.map((i) => ({ id: i.ingredientId, qty: i.buyQty, unit: i.buyUnit, source: i.source })).sort((a, b) => a.id.localeCompare(b.id));
  const before = totals((await request(app).post('/api/lists/generate').send({ date: WED })).body.items);
  // Both dinners are ×2 for two people: 8 oz paneer -> 1 lb, 4 oz potato -> 0.5 lb. Pinned absolutely,
  // so the comparison below cannot pass on two equally wrong lists.
  expect(before).toEqual([
    { id: paneer.id, qty: 1, unit: 'lb', source: 'auto' },
    { id: potato.id, qty: 0.5, unit: 'lb', source: 'auto' },
  ].sort((a, b) => a.id.localeCompare(b.id)));
  await mark(TUE, { name: 'Parivartini' }).expect(200);
  const after = totals((await request(app).post('/api/lists/generate').send({ date: WED })).body.items);
  expect(after).toEqual(before);
});
