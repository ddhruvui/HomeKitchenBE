import request from 'supertest';
import { buildApp } from '../app';
import { askAboutCooking, buildPrompt, chatSystemPrompt, estimateBridges, sanitize } from '../gemini';
import type { ChatTurn, GenerateOpts } from '../gemini';
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

describe('asking about a dish', () => {
  const turns: ChatTurn[] = [
    { role: 'user', text: 'How do I make pav bhaji?' },
    { role: 'model', text: 'Boil the potatoes.' },
    { role: 'user', text: 'Can I skip the capsicum?' },
  ];

  test('the follow-up is the prompt and everything before it is the history', async () => {
    let seen: { prompt: string; opts?: GenerateOpts } | null = null;
    const reply = await askAboutCooking(turns, ['Potato'], async (prompt, opts) => { seen = { prompt, opts }; return '  Yes, use extra potato.  '; });
    expect(reply).toBe('Yes, use extra potato.');
    expect(seen!.prompt).toBe('Can I skip the capsicum?');
    expect(seen!.opts?.history).toEqual(turns.slice(0, 2));
    expect(seen!.opts?.text).toBe(true);
    expect(seen!.opts?.system).toMatch(/Potato/);
  });

  test('an empty answer is an error, not an empty bubble', async () => {
    await expect(askAboutCooking(turns, [], async () => '   ')).rejects.toThrow(/nothing to say/);
  });

  test('the prompt carries the house conventions and the catalog', () => {
    const p = chatSystemPrompt(['Toor Dal', 'Yellow Onion']);
    expect(p).toMatch(/TWO people/); expect(p).toMatch(/Never metric/);
    expect(p).toMatch(/Toor Dal, Yellow Onion/);
    expect(chatSystemPrompt([])).not.toMatch(/already in the catalog/);
  });
});

describe('POST /api/ai/chat', () => {
  const seen: Array<{ prompt: string; opts?: GenerateOpts }> = [];
  const app = buildApp({ generate: async (prompt, opts) => { seen.push({ prompt, opts }); return `you said: ${prompt}`; } });
  beforeAll(openTestDb); beforeEach(() => { seen.length = 0; return clearTestDb(); }); afterAll(closeTestDb);

  test('answers a first question, and names the catalog in the system prompt', async () => {
    const s = (await request(app).post('/api/stores').send({ name: 'Costco' })).body;
    await request(app).post('/api/ingredients').send({ name: 'Paneer', kind: 'fresh', storeId: s.id, form: 'Dairy', buyUnit: 'lb' });
    const r = await request(app).post('/api/ai/chat').send({ messages: [{ role: 'user', text: 'How do I make palak paneer?' }] });
    expect(r.status).toBe(200);
    expect(r.body.reply).toBe('you said: How do I make palak paneer?');
    expect(seen[0].opts?.system).toMatch(/Paneer/);
    expect(seen[0].opts?.history).toEqual([]);
  });

  test('a follow-up carries the turns before it', async () => {
    const messages = [{ role: 'user', text: 'Pav bhaji?' }, { role: 'model', text: 'Boil.' }, { role: 'user', text: 'For four?' }];
    const r = await request(app).post('/api/ai/chat').send({ messages });
    expect(r.status).toBe(200);
    expect(seen[0].prompt).toBe('For four?');
    expect(seen[0].opts?.history).toHaveLength(2);
  });

  test('nothing is written to the catalog', async () => {
    await request(app).post('/api/ai/chat').send({ messages: [{ role: 'user', text: 'Invent an ingredient' }] }).expect(200);
    expect((await request(app).get('/api/ingredients')).body).toEqual([]);
  });

  test('an empty conversation, and one ending on the model, are both 400', async () => {
    await request(app).post('/api/ai/chat').send({ messages: [] }).expect(400);
    const r = await request(app).post('/api/ai/chat').send({ messages: [{ role: 'model', text: 'hi' }] });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/has to be yours/);
  });
});
