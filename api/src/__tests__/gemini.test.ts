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
  test('a second object, or a stray word, after the answer does not lose the answer', async () => {
    // Seen live: a 502 on a real draft because the model appended a second object and "first { to last }" spanned both.
    const one = '{"title":"Poha","ingredients":[{"name":"Poha { not a brace","qty":2,"unit":"cup","note":"say \\"two\\""}],"steps":["Rinse."]}';
    for (const raw of [`${one}\n${one}`, `Here you go:\n${one}\nHope that helps!`]) {
      const d = await draftRecipe('Poha', async () => raw);
      expect(d.lines).toEqual([{ name: 'Poha { not a brace', qty: 2, unit: 'cup', note: 'say "two"' }]);
    }
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

describe('POST /api/ai/recipe from a link', () => {
  const ld = (obj: unknown) => `<html><script type="application/ld+json">${JSON.stringify(obj)}</script></html>`;
  const answer = JSON.stringify({ title: 'Pav Bhaji', ingredients: [{ name: 'Potato', qty: 1, unit: 'cup', kind: 'fresh', form: 'Produce' }], steps: ['Boil.'] });
  const seen: Array<{ prompt: string; opts?: { videoUrl?: string; readUrl?: boolean; timeoutMs?: number } }> = [];
  const app = buildApp({ generate: async (prompt, opts) => { seen.push({ prompt, opts }); return answer; } });
  const realFetch = global.fetch;
  beforeAll(openTestDb); beforeEach(() => { seen.length = 0; return clearTestDb(); });
  afterEach(() => { global.fetch = realFetch; }); afterAll(closeTestDb);

  test("a page's own JSON-LD is used, and the model is told to halve a recipe for four", async () => {
    global.fetch = jest.fn(async () => new Response(ld({ '@type': 'Recipe', name: 'Mumbai Pav Bhaji', recipeYield: '4', recipeIngredient: ['2 large potatoes', '1 cup peas'], recipeInstructions: 'Boil. Mash.' }), { status: 200 })) as unknown as typeof fetch;
    const r = await request(app).post('/api/ai/recipe').send({ url: 'https://www.indianhealthyrecipes.com/pav-bhaji-recipe/' });
    expect(r.status).toBe(200);
    expect(r.body.source).toEqual({ kind: 'web', label: 'indianhealthyrecipes.com', url: 'https://www.indianhealthyrecipes.com/pav-bhaji-recipe/', servings: 4 });
    expect(r.body.servings).toBe(2);
    expect(seen).toHaveLength(1);
    expect(seen[0].prompt).toMatch(/The source serves 4\. Rescale every amount to TWO people/);
    expect(seen[0].prompt).toMatch(/- 2 large potatoes/);
    expect(seen[0].opts?.readUrl).toBeUndefined();     // the page was read by us, not by the model
    expect(await RecipeModel.countDocuments()).toBe(0);
  });

  test('a page without JSON-LD falls back to the model reading it, on the longer budget', async () => {
    global.fetch = jest.fn(async () => new Response('<html>a blog post</html>', { status: 200 })) as unknown as typeof fetch;
    const r = await request(app).post('/api/ai/recipe').send({ url: 'https://example.com/some-post' });
    expect(r.status).toBe(200);
    expect(seen[0].opts).toMatchObject({ readUrl: true, timeoutMs: 60_000 });
    expect(seen[0].prompt).toMatch(/Read this page/);
  });

  test('a site that blocks us is not a dead end — the model is asked to read it instead', async () => {
    global.fetch = jest.fn(async () => new Response('nope', { status: 403 })) as unknown as typeof fetch;
    await request(app).post('/api/ai/recipe').send({ url: 'https://www.allrecipes.com/recipe/1/' }).expect(200);
    expect(seen[0].opts?.readUrl).toBe(true);
  });

  test('a YouTube link is watched, not fetched', async () => {
    global.fetch = jest.fn(async () => { throw new Error('the page must not be fetched'); }) as unknown as typeof fetch;
    const r = await request(app).post('/api/ai/recipe').send({ url: 'https://youtu.be/Gbuse4WX01I' });
    expect(r.status).toBe(200);
    expect(r.body.source).toMatchObject({ kind: 'video', label: 'youtu.be' });
    expect(seen[0].opts).toMatchObject({ videoUrl: 'https://youtu.be/Gbuse4WX01I', timeoutMs: 60_000 });
    expect(seen[0].prompt).toMatch(/from the video, not from memory/);
  });

  test('a link into the house network is refused before anything fetches it', async () => {
    global.fetch = jest.fn(async () => { throw new Error('must not fetch'); }) as unknown as typeof fetch;
    const r = await request(app).post('/api/ai/recipe').send({ url: 'http://192.168.1.10/admin' });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/private network/);
  });

  test('a link with no recipe in it says so, and points back at the dish name', async () => {
    global.fetch = jest.fn(async () => new Response('<html>nothing</html>', { status: 200 })) as unknown as typeof fetch;
    const empty = buildApp({ generate: async () => JSON.stringify({ ingredients: [] }) });
    const r = await request(empty).post('/api/ai/recipe').send({ url: 'https://example.com/not-a-recipe' });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/no recipe found at example.com — try the dish name/);
  });

  test('neither a dish name nor a link is a 400', async () => {
    await request(app).post('/api/ai/recipe').send({}).expect(400);
  });
});
