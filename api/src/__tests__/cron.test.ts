import request from 'supertest';
import { addDays } from '@home-kitchen/shared';
import { buildApp } from '../app';
import { KEEP_DAYS } from '../routes/cron';
import { clearTestDb, closeTestDb, openTestDb } from './testDb';

const app = buildApp();
beforeAll(openTestDb); beforeEach(clearTestDb); afterAll(closeTestDb);
afterEach(() => { delete process.env.CRON_SECRET; });

const today = new Date().toISOString().slice(0, 10);
const put = (date: string) => request(app).put(`/api/plan/${date}`).send({}).expect(200);

describe('cleanup cron', () => {
  test('deletes plans older than three weeks and keeps the rest', async () => {
    const stale = addDays(today, -KEEP_DAYS - 1);
    const oldest = addDays(today, -400);
    const edge = addDays(today, -KEEP_DAYS);
    const future = addDays(today, 3);
    for (const date of [oldest, stale, edge, today, future]) await put(date);

    const r = await request(app).get('/api/cron/cleanup').expect(200);
    expect(r.body).toMatchObject({ ok: true, before: edge, deletedPlannedDays: 2 });

    const left = (await request(app).get(`/api/plan/week?date=${edge}`)).body;
    expect(left.days.some((d: { date: string }) => d.date === edge)).toBe(true);
    const r2 = await request(app).get('/api/cron/cleanup').expect(200);
    expect(r2.body.deletedPlannedDays).toBe(0); // nothing left to delete
  });

  test('a CRON_SECRET, once set, is required', async () => {
    process.env.CRON_SECRET = 's3cret';
    await request(app).get('/api/cron/cleanup').expect(401);
    await request(app).get('/api/cron/cleanup').set('Authorization', 'Bearer nope').expect(401);
    await request(app).get('/api/cron/cleanup').set('Authorization', 'Bearer s3cret').expect(200);
  });
});
