import { todayView } from '../today';
import { addDays, weekStartFor, daysInRange, isValidDate, expiryStatus, daysBetween } from '../dates';
import { validateRecipeLine, bridgeNeededFor } from '../validate';
import type { Ingredient, Recipe } from '../types';

const onion: Ingredient = { id: 'onion', name: 'Yellow Onion', kind: 'fresh', storeId: 's', form: 'Produce', buyUnit: 'each', countUnit: 'each', ozPerCount: 5.3 };
const cor: Ingredient = { id: 'cor', name: 'Coriander', kind: 'fresh', storeId: 's', form: 'Produce', buyUnit: 'bunch', countUnit: 'bunch', ozPerCount: 2.5 };
const masala: Ingredient = { id: 'm', name: 'Masala', kind: 'pantry', storeId: 's', form: 'Spices' };

describe('todayView', () => {
  const pav: Recipe = { id: 'pav', title: 'Pav Bhaji', tags: [], steps: ['Boil potatoes.', 'Mash.'],
    ingredients: [{ ingredientId: 'onion', qty: 1, unit: 'cup', note: 'chopped' }, { ingredientId: 'm', qty: 2, unit: 'tbsp' }] };
  const thepla: Recipe = { id: 't', title: 'Thepla', tags: [], steps: [], ingredients: [{ ingredientId: 'onion', qty: 0.5, unit: 'cup' }] };
  const R = { pav, t: thepla };
  const I = { onion, m: masala };

  test('breakfast ×1, dinner ×2, lunch is yesterday, pantry lines keep their amount', () => {
    const days = [{ date: '2026-09-05', breakfast: [], dinner: ['pav'] }, { date: '2026-09-06', breakfast: ['t'], dinner: ['pav'] }];
    const v = todayView({ date: '2026-09-06', days, ekadashi: [], recipes: R, ingredients: I, settings: { people: 2, weekStartsOn: 6 } });
    expect(v.breakfast[0].lines[0].qty).toBe(0.5);
    expect(v.dinner[0].lines[0]).toMatchObject({ qty: 2, unit: 'cup', note: 'chopped' });
    expect(v.dinner[0].lines[1]).toMatchObject({ name: 'Masala', qty: 4, unit: 'tbsp' });
    expect(v.dinner[0].steps).toEqual(['Boil potatoes.', 'Mash.']);
    expect(v.lunch).toEqual(['Pav Bhaji']); expect(v.lunchFrom).toBe('2026-09-05'); expect(v).toMatchObject({ isEkadashi: false, dinnerCookedOn: '2026-09-06', cookAhead: null });
  });
  test('four people doubles everything again', () => {
    const days = [{ date: '2026-09-06', breakfast: ['t'], dinner: ['pav'] }];
    const v = todayView({ date: '2026-09-06', days, ekadashi: [], recipes: R, ingredients: I, settings: { people: 4, weekStartsOn: 6 } });
    expect(v.breakfast[0].factor).toBe(2); expect(v.dinner[0].factor).toBe(4); expect(v.dinner[0].lines[0].qty).toBe(4); expect(v.lunch).toEqual([]);
  });
  test('an unplanned day is empty, not an error', () => {
    const v = todayView({ date: '2026-09-06', days: [], ekadashi: [], recipes: R, ingredients: I, settings: { people: 2, weekStartsOn: 6 } });
    expect(v).toMatchObject({ breakfast: [], lunch: [], lunchFrom: null, dinner: [], cookAhead: null });
  });
});

describe('dates', () => {
  test('addDays crosses months and years', () => { expect(addDays('2026-09-26', 6)).toBe('2026-10-02'); expect(addDays('2026-12-30', 3)).toBe('2027-01-02'); });
  test('weekStartFor with a Saturday start', () => {
    expect(weekStartFor('2026-09-05', 6)).toBe('2026-09-05'); // a Saturday
    expect(weekStartFor('2026-09-09', 6)).toBe('2026-09-05'); // Wednesday → previous Saturday
    expect(weekStartFor('2026-09-11', 6)).toBe('2026-09-05'); // Friday
    expect(weekStartFor('2026-09-12', 6)).toBe('2026-09-12');
    expect(weekStartFor('2026-09-09', 1)).toBe('2026-09-07'); // Monday start
  });
  test('expiry is judged against today', () => {
    expect(expiryStatus('2026-09-01', '2026-09-03')).toEqual({ status: 'expired', days: -2 });
    expect(expiryStatus('2026-09-03', '2026-09-03')).toEqual({ status: 'soon', days: 0 });
    expect(expiryStatus('2026-10-03', '2026-09-03')).toEqual({ status: 'soon', days: 30 });
    expect(expiryStatus('2026-10-04', '2026-09-03')).toEqual({ status: 'later', days: 31 });
    expect(daysBetween('2026-12-30', '2027-01-02')).toBe(3);
  });
  test('daysInRange and validity', () => {
    expect(daysInRange('2026-09-05', '2026-09-11')).toHaveLength(7);
    expect(isValidDate('2026-02-30')).toBe(false); expect(isValidDate('2026-09-05')).toBe(true); expect(isValidDate('9/5/2026')).toBe(false);
  });
});

describe('validateRecipeLine', () => {
  test('a count unit must be the ingredient\'s own', () => {
    expect(validateRecipeLine({ ingredientId: 'onion', qty: 2, unit: 'bunch' }, onion)).toMatch(/counted in each/);
    expect(validateRecipeLine({ ingredientId: 'onion', qty: 2, unit: 'each' }, onion)).toBeNull();
    expect(validateRecipeLine({ ingredientId: 'cor', qty: 0.5, unit: 'bunch' }, cor)).toBeNull();
  });
  test('weight and volume are always fine for a fresh ingredient', () => {
    expect(validateRecipeLine({ ingredientId: 'onion', qty: 1, unit: 'cup' }, onion)).toBeNull();
    expect(validateRecipeLine({ ingredientId: 'onion', qty: 4, unit: 'oz' }, onion)).toBeNull();
  });
  test('pantry lines may carry any quantity or none', () => {
    expect(validateRecipeLine({ ingredientId: 'm', qty: 2, unit: 'tbsp' }, masala)).toBeNull();
    expect(validateRecipeLine({ ingredientId: 'm' }, masala)).toBeNull();
  });
  test('qty and unit go together; qty must be positive', () => {
    expect(validateRecipeLine({ ingredientId: 'onion', qty: 1 }, onion)).toMatch(/go together/);
    expect(validateRecipeLine({ ingredientId: 'onion', qty: 0, unit: 'cup' }, onion)).toMatch(/positive/);
    expect(validateRecipeLine({ ingredientId: 'x', qty: 1, unit: 'cup' }, undefined)).toMatch(/unknown ingredient/);
  });
  test('bridgeNeededFor names the missing bridge', () => {
    expect(bridgeNeededFor({ ...onion, ozPerCount: 5.3, ozPerCup: undefined }, 'cup')).toBe('ozPerCup');
    expect(bridgeNeededFor({ ...onion, ozPerCup: 5.6 }, 'cup')).toBeNull();
    expect(bridgeNeededFor(onion, 'each')).toBeNull();
    expect(bridgeNeededFor(masala, 'cup')).toBeNull();
  });
});
