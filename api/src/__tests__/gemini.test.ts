import request from 'supertest';
import { buildApp } from '../app';
import { buildPrompt, estimateBridges, sanitize } from '../gemini';
import { clearTestDb, closeTestDb, openTestDb } from './testDb';

describe('sanitize', () => {
  test('keeps plausible numbers, rounds, drops nonsense', () => {
    expect(sanitize({ id: 'x', ozPerCup: 5.637, ozPerCount: 5.3, rationale: 'r' })).toEqual({ id: 'x', ozPerCup: 5.64, ozPerCount: 5.3, rationale: 'r' });
    expect(sanitize({ id: 'x', ozPerCup: 0, ozPerCount: -1 })).toBeNull();
    expect(sanitize({ id: 'x', ozPerCup: 500 })).toBeNull();
    expect(sanitize({ id: 'x', ozPerCup: Number.NaN, ozPerCount: 2 })).toEqual({ id: 'x', ozPerCount: 2, rationale: '' });
  });
});

describe('estimateBridges', () => {
  test('one call for the batch, parses fenced JSON, ignores ids it did not ask for', async () => {
    const calls: string[] = [];
    const gen = async (p: string) => { calls.push(p); return '```json\n[{"id":"a","ozPerCup":5.6,"rationale":"chopped onion"},{"id":"zzz","ozPerCup":1}]\n```'; };
    const out = await estimateBridges([{ id: 'a', name: 'Onion', countUnit: 'each', wantCup: true, wantCount: false }], gen);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatch(/Onion/);
    expect(out).toEqual([{ id: 'a', ozPerCup: 5.6, rationale: 'chopped onion' }]);
  });
  test('no requests means no call', async () => {
    let called = false;
    expect(await estimateBridges([], async () => { called = true; return '[]'; })).toEqual([]);
    expect(called).toBe(false);
  });
  test('garbage from the model is an error, not a silent write', async () => {
    await expect(estimateBridges([{ id: 'a', name: 'X', wantCup: true, wantCount: false }], async () => 'no json here')).rejects.toThrow();
  });
  test('the prompt asks only for what is missing', () => {
    const p = buildPrompt([{ id: 'c', name: 'Coriander', countUnit: 'bunch', wantCup: false, wantCount: true }]);
    expect(p).toMatch(/ozPerCount/); expect(p).not.toMatch(/ozPerCup: weight/); expect(p).toMatch(/bunch/);
  });
});

describe('POST /api/ai/bridges', () => {
  const seen: string[] = [];
  const app = buildApp({ generate: async (p) => { seen.push(p); return JSON.stringify([{ id: 'ignored', ozPerCup: 1 }]).replace('ignored', p.match(/id "(\w+)"/)![1]); } });
  beforeAll(openTestDb); beforeEach(() => { seen.length = 0; return clearTestDb(); }); afterAll(closeTestDb);

  test('asks about the ingredients recipes cannot convert, returns suggestions, writes nothing', async () => {
    const s = (await request(app).post('/api/stores').send({ name: 'Costco' })).body;
    const onion = (await request(app).post('/api/ingredients').send({ name: 'Onion', kind: 'fresh', storeId: s.id, form: 'Produce', buyUnit: 'each', countUnit: 'each', ozPerCount: 5.3 })).body;
    await request(app).post('/api/recipes').send({ title: 'Pav Bhaji', ingredients: [{ ingredientId: onion.id, qty: 1, unit: 'cup' }] });
    const r = await request(app).post('/api/ai/bridges').send({});
    expect(r.status).toBe(200);
    expect(r.body.estimates).toEqual([expect.objectContaining({ id: onion.id, name: 'Onion', ozPerCup: 1 })]);
    expect(seen).toHaveLength(1);
    expect((await request(app).get(`/api/ingredients`)).body[0].ozPerCup).toBeUndefined();
  });
  test('nothing to estimate means no model call', async () => {
    const r = await request(app).post('/api/ai/bridges').send({});
    expect(r.body.estimates).toEqual([]); expect(seen).toHaveLength(0);
  });
});
