import { cookAheadDate, cookedOn, lunchSourceDate, MAX_CARRY_LOOKBACK } from '../ekadashi';
import { todayView } from '../today';
import type { Ingredient, PlannedDay, Recipe } from '../types';

const fasts = (...dates: string[]) => (d: string) => dates.includes(d);
// The user's own worked example (§4): Mon dinner Palak Paneer, Tue Ekadashi Bateta Bhaji, Wed ordinary.
const MON = '2026-09-07', TUE = '2026-09-08', WED = '2026-09-09', THU = '2026-09-10';

describe('lunchSourceDate', () => {
  test('an ordinary day after an ordinary day is yesterday, exactly as before', () => {
    expect(lunchSourceDate(WED, fasts())).toBe(TUE);
    expect(lunchSourceDate(MON, fasts(THU))).toBe('2026-09-06');
  });
  test('the worked example: Wednesday eats Monday, because Tuesday finished its own pot', () => {
    expect(lunchSourceDate(WED, fasts(TUE))).toBe(MON);
  });
  test('a fast day eats its own dish at lunch', () => { expect(lunchSourceDate(TUE, fasts(TUE))).toBe(TUE); });
  test('two and three consecutive fasts carry further back', () => {
    expect(lunchSourceDate(THU, fasts(TUE, WED))).toBe(MON);
    expect(lunchSourceDate('2026-09-11', fasts(TUE, WED, THU))).toBe(MON);
  });
  test('the lookback cap stops the walk instead of running forever', () => {
    const seven = ['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-05', '2026-09-06', MON];
    expect(seven).toHaveLength(MAX_CARRY_LOOKBACK);
    expect(lunchSourceDate(TUE, fasts(...seven))).toBeNull();
    expect(lunchSourceDate(TUE, fasts(...seven.slice(1)))).toBe('2026-09-01');
  });
});

describe('cookedOn and cookAheadDate', () => {
  test('a fast day is cooked the evening before; an ordinary day cooks its own', () => {
    expect(cookedOn(TUE, fasts(TUE))).toBe(MON);
    expect(cookedOn(WED, fasts(TUE))).toBe(WED);
    expect(cookedOn(TUE, fasts(TUE, WED))).toBe(MON); // back-to-back fasts still only step one night
  });
  test('the evening before a fast cooks twice, every other evening once', () => {
    expect(cookAheadDate(MON, fasts(TUE))).toBe(TUE);
    expect(cookAheadDate(TUE, fasts(TUE))).toBeNull();
    expect(cookAheadDate(TUE, fasts(TUE, WED))).toBe(WED);
  });
});

describe('todayView with fasts', () => {
  const onion: Ingredient = { id: 'onion', name: 'Yellow Onion', kind: 'fresh', storeId: 's', form: 'Produce', buyUnit: 'each', countUnit: 'each', ozPerCount: 5.3 };
  const palak: Recipe = { id: 'palak', title: 'Palak Paneer', tags: [], steps: ['Blanch.'], ingredients: [{ ingredientId: 'onion', qty: 1, unit: 'cup' }] };
  const bateta: Recipe = { id: 'bateta', title: 'Bateta Bhaji', tags: [], steps: ['Boil.'], ingredients: [{ ingredientId: 'onion', qty: 2, unit: 'cup' }] };
  const thepla: Recipe = { id: 'thepla', title: 'Thepla', tags: [], steps: [], ingredients: [{ ingredientId: 'onion', qty: 0.5, unit: 'cup' }] };
  const R = { palak, bateta, thepla };
  const I = { onion };
  const days: PlannedDay[] = [
    { date: MON, breakfast: ['thepla'], dinner: ['palak'] },
    { date: TUE, breakfast: ['thepla'], dinner: ['bateta'] },
    { date: WED, breakfast: [], dinner: ['palak'] },
  ];
  const view = (date: string, over: Partial<Parameters<typeof todayView>[0]> = {}) =>
    todayView({ date, days, ekadashi: [TUE], recipes: R, ingredients: I, settings: { people: 2, weekStartsOn: 6 }, ...over });

  test('Monday cooks its own dinner and tomorrow\'s fast dish, both ×2', () => {
    const v = view(MON);
    expect(v).toMatchObject({ isEkadashi: false, dinnerCookedOn: MON });
    expect(v.dinner[0]).toMatchObject({ title: 'Palak Paneer', factor: 2 });
    expect(v.breakfast[0]).toMatchObject({ title: 'Thepla', factor: 1 });
    expect(v.cookAhead?.date).toBe(TUE);
    expect(v.cookAhead?.recipes[0]).toMatchObject({ title: 'Bateta Bhaji', factor: 2 });
    expect(v.cookAhead?.recipes[0].lines[0].qty).toBe(4);
  });
  test('the fast day eats one dish twice, cooked last night, and keeps its breakfast', () => {
    const v = view(TUE);
    expect(v).toMatchObject({ isEkadashi: true, dinnerCookedOn: MON, lunchFrom: MON, cookAhead: null });
    expect(v.lunch).toEqual(['Bateta Bhaji']);
    expect(v.dinner[0]).toMatchObject({ title: 'Bateta Bhaji', factor: 2 });
    expect(v.breakfast[0]).toMatchObject({ title: 'Thepla', factor: 1 });
  });
  test('Wednesday\'s lunch is Monday\'s dinner, cooked Monday evening', () => {
    const v = view(WED);
    expect(v.lunch).toEqual(['Palak Paneer']);
    expect(v).toMatchObject({ isEkadashi: false, lunchFrom: MON, dinnerCookedOn: WED, cookAhead: null });
  });
  test('with no fast at all it behaves exactly as it always did', () => {
    const v = view(WED, { ekadashi: [] });
    expect(v.lunch).toEqual(['Bateta Bhaji']);
    expect(v).toMatchObject({ lunchFrom: TUE, dinnerCookedOn: WED, cookAhead: null, isEkadashi: false });
  });
  test('the walk skips fasts, never unplanned evenings: an empty Monday leaves Wednesday hungry', () => {
    const v = view(WED, { days: [{ date: MON, breakfast: [], dinner: [] }, days[1], days[2]] });
    expect(v).toMatchObject({ lunch: [], lunchFrom: null });
  });
  test('lunchFrom is null exactly when lunch is empty', () => {
    expect(view(MON, { days: [days[0]] }).lunchFrom).toBeNull(); // Sunday was never planned
    expect(view(MON).lunchFrom).toBeNull();
    expect(view(TUE, { days: [{ date: TUE, breakfast: [], dinner: [] }] })).toMatchObject({ lunch: [], lunchFrom: null });
  });
  test('cookAhead is null when tomorrow fasts on an empty dinner', () => {
    expect(view(MON, { days: [days[0], { date: TUE, breakfast: ['thepla'], dinner: [] }] }).cookAhead).toBeNull();
  });
  test('people scale the fast dish like any other, ×1 breakfast and ×2 dinner', () => {
    const v = view(TUE, { settings: { people: 4, weekStartsOn: 6 } });
    expect(v.people).toBe(4);
    expect(v.breakfast[0]).toMatchObject({ factor: 2 });
    expect(v.dinner[0]).toMatchObject({ factor: 4 });
    expect(v.dinner[0].lines[0].qty).toBe(8);
    expect(view(MON, { settings: { people: 4, weekStartsOn: 6 } }).cookAhead?.recipes[0].factor).toBe(4);
  });
});
