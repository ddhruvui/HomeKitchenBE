import request from 'supertest';
import { buildApp } from '../app';
import { buildPrompt, buildRecipePrompt, draftRecipe, estimateBridges, normalizeUnit, sanitize, sanitizeRecipeDraft } from '../gemini';
import { IngredientModel, RecipeModel } from '../models';
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

describe('recipe drafting', () => {
  test('units are normalised to our vocabulary, odd ones kept as text', () => {
    expect(normalizeUnit('Tablespoons')).toBe('tbsp'); expect(normalizeUnit('fl oz')).toBe('floz'); expect(normalizeUnit('medium')).toBe('each'); expect(normalizeUnit('pinch')).toBeUndefined();
  });
  test('sanitizer coerces, caps and keeps what it cannot read', () => {
    const d = sanitizeRecipeDraft({ title: ' Pav Bhaji ', ingredients: [
      { name: 'Potato', qty: '2', unit: 'cups', note: 'boiled', kind: 'Fresh', form: 'produce' },
      { name: 'Salt', qty: 1, unit: 'pinch', kind: 'pantry' },
      { name: '', qty: 1, unit: 'cup' }, { name: 'Ghost', qty: -3, unit: 'cup' },
      ...Array.from({ length: 50 }, (_, i) => ({ name: 'Filler ' + i, qty: 1, unit: 'tsp' })),
    ], steps: ['Boil.', '', 42, 'x'.repeat(400)] }, 'Pav Bhaji');
    expect(d.title).toBe('Pav Bhaji');
    expect(d.lines[0]).toEqual({ name: 'Potato', qty: 2, unit: 'cup', note: 'boiled', kind: 'fresh', form: 'Produce' });
    expect(d.lines[1]).toEqual({ name: 'Salt', qty: 1, rawUnit: 'pinch', kind: 'pantry' });
    expect(d.lines[2]).toEqual({ name: 'Ghost' });
    expect(d.lines).toHaveLength(40);
    expect(d.steps).toHaveLength(2); expect(d.steps[1]).toHaveLength(300);
  });
  test('an empty or malformed answer is an error, not an empty recipe', () => {
    expect(() => sanitizeRecipeDraft({ ingredients: [] }, 'X')).toThrow(/no ingredients/);
    expect(() => sanitizeRecipeDraft('nope', 'X')).toThrow();
  });
  test('the prompt says two people and lists our units', () => { const p = buildRecipePrompt('Pav Bhaji'); expect(p).toMatch(/TWO people/); expect(p).toMatch(/floz/); expect(p).toMatch(/Dish: "Pav Bhaji"/); });
  test('draftRecipe unwraps fenced JSON', async () => {
    const d = await draftRecipe('Poha', async () => '```json\n{"title":"Poha","ingredients":[{"name":"Poha","qty":2,"unit":"cup"}],"steps":["Rinse."]}\n```');
    expect(d.lines[0].unit).toBe('cup'); expect(d.steps).toEqual(['Rinse.']);
  });
});

describe('POST /api/ai/recipe', () => {
  const app = buildApp({ generate: async () => JSON.stringify({ title: 'Pav Bhaji', ingredients: [
    { name: 'Potatoes', qty: 2, unit: 'cups', note: 'boiled and mashed', kind: 'fresh', form: 'Produce' },
    { name: 'Onion', qty: 1, unit: 'cup', kind: 'fresh', form: 'Produce' },
    { name: 'Cilantro', qty: 0.5, unit: 'cup', kind: 'fresh', form: 'Produce' },
    { name: 'Lemon', qty: 1, unit: 'each', kind: 'fresh', form: 'Produce' },
  ], steps: ['Boil.', 'Mash.'] }) });
  beforeAll(openTestDb); beforeEach(clearTestDb); afterAll(closeTestDb);
  test('drafts for two, matches the catalog, writes nothing', async () => {
    const s = (await request(app).post('/api/stores').send({ name: 'Costco' })).body;
    for (const name of ['Potato', 'Yellow Onion', 'Coriander']) await request(app).post('/api/ingredients').send({ name, kind: 'fresh', storeId: s.id, form: 'Produce', buyUnit: 'each', countUnit: 'each' });
    const r = await request(app).post('/api/ai/recipe').send({ title: 'Pav Bhaji' });
    expect(r.status).toBe(200);
    expect(r.body.servings).toBe(2);
    const byName = Object.fromEntries(r.body.lines.map((l: { name: string; match: unknown }) => [l.name, l.match]));
    expect(byName.Potatoes).toMatchObject({ name: 'Potato', confidence: 'exact' });
    expect(byName.Onion).toMatchObject({ name: 'Yellow Onion', confidence: 'partial' });
    expect(byName.Cilantro).toMatchObject({ name: 'Coriander', confidence: 'exact' });
    expect(byName.Lemon).toBeNull();
    expect(r.body.steps).toEqual(['Boil.', 'Mash.']);
    expect(await RecipeModel.countDocuments()).toBe(0);
    expect(await IngredientModel.countDocuments()).toBe(3);
  });
  test('needs a title', async () => { await request(app).post('/api/ai/recipe').send({}).expect(400); });
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
