import { generateList, mergeLists, type GenerateInput } from '../generate';
import type { Ingredient, Recipe, Store } from '../types';

const stores: Store[] = [
  { id: 'costco', name: 'Costco', sortOrder: 1, color: '#4f8a5f' },
  { id: 'indian', name: 'Indian Store', sortOrder: 2, color: '#b07d33' },
];
const ing = (i: Partial<Ingredient> & Pick<Ingredient, 'id' | 'name' | 'kind' | 'storeId' | 'form'>): Ingredient => i;
const I: Record<string, Ingredient> = Object.fromEntries([
  ing({ id: 'onion', name: 'Yellow Onion', kind: 'fresh', storeId: 'costco', form: 'Produce', buyUnit: 'each', stockUnit: 'each', countUnit: 'each', ozPerCup: 5.6, ozPerCount: 5.3 }),
  ing({ id: 'paneer', name: 'Paneer', kind: 'fresh', storeId: 'costco', form: 'Dairy', buyUnit: 'lb', stockUnit: 'lb' }),
  ing({ id: 'cor', name: 'Coriander', kind: 'fresh', storeId: 'indian', form: 'Produce', buyUnit: 'bunch', stockUnit: 'bunch', countUnit: 'bunch', ozPerCount: 2.5 }),
  ing({ id: 'milk', name: 'Milk', kind: 'weekly', storeId: 'costco', form: 'Dairy', weeklyQty: 2 }),
  ing({ id: 'rice', name: 'Basmati Rice', kind: 'pantry', storeId: 'indian', form: 'Dry Goods', isLow: true }),
  ing({ id: 'dal', name: 'Toor Dal', kind: 'pantry', storeId: 'indian', form: 'Dry Goods', isLow: false }),
  ing({ id: 'masala', name: 'Pav Bhaji Masala', kind: 'pantry', storeId: 'indian', form: 'Spices', isLow: true }),
].map((x) => [x.id, x]));

const R: Record<string, Recipe> = {
  pav: { id: 'pav', title: 'Pav Bhaji', tags: [], steps: [],
    ingredients: [{ ingredientId: 'onion', qty: 1, unit: 'cup' }, { ingredientId: 'masala', qty: 2, unit: 'tbsp' }, { ingredientId: 'cor', qty: 0.5, unit: 'bunch' }] },
  palak: { id: 'palak', title: 'Palak Paneer', tags: [], steps: [],
    ingredients: [{ ingredientId: 'paneer', qty: 8, unit: 'oz' }, { ingredientId: 'onion', qty: 0.5, unit: 'cup' }] },
  poha: { id: 'poha', title: 'Poha', tags: [], steps: [], ingredients: [{ ingredientId: 'onion', qty: 1, unit: 'each' }] },
};

function base(over: Partial<GenerateInput> = {}): GenerateInput {
  return {
    startDate: '2026-09-05', endDate: '2026-09-11',
    days: [
      { date: '2026-09-05', breakfast: ['poha'], dinner: ['pav'] },
      { date: '2026-09-06', breakfast: [], dinner: ['palak'] },
    ],
    recipes: R, ingredients: I, stores,
    freshStock: [{ ingredientId: 'onion', qty: 3, unit: 'each' }],
    settings: { people: 2, weekStartsOn: 6 },
    ...over,
  };
}
const find = (items: ReturnType<typeof generateList>['items'], id: string) => items.find((i) => i.ingredientId === id);

describe('generateList', () => {
  test('dinner counts double, breakfast single, and the fridge is subtracted — summed in the buy unit (§12 K)', () => {
    // onion is bought by count, so everything is totalled in onions:
    // poha breakfast 1 each + pav dinner 1 cup ×2 (11.2 oz = 2.11 each) + palak dinner 0.5 cup ×2 (5.6 oz = 1.06 each) = 4.17 each; have 3 → short 1.17
    const out = generateList(base());
    const onion = find(out.items, 'onion')!;
    expect(onion.needUnit).toBe('each');
    expect(onion.needQty).toBeCloseTo(4.17, 1);
    expect(onion.haveQty).toBe(3);
    expect(onion.buyUnit).toBe('each');
    expect(onion.buyQty).toBeCloseTo(1.17, 1);
    expect(onion.altUnit).toBe('oz');
    expect(onion.altQty).toBeCloseTo(1.17 * 5.3, 0);
  });

  test('an ingredient with enough on hand is not on the list at all', () => {
    const out = generateList(base({ freshStock: [{ ingredientId: 'onion', qty: 10, unit: 'each' }, { ingredientId: 'paneer', qty: 2, unit: 'lb' }] }));
    expect(find(out.items, 'onion')).toBeUndefined();
    expect(find(out.items, 'paneer')).toBeUndefined();
  });

  test('fridge entered in a different family than the recipe still reconciles through the bridge', () => {
    const out = generateList(base({ freshStock: [{ ingredientId: 'onion', qty: 1, unit: 'lb' }] }));
    expect(find(out.items, 'onion')!.haveQty).toBeCloseTo(16 / 5.3, 1); // a pound of onions, counted in onions
  });

  test('headcount scales recipe lines and weekly items, not the fridge', () => {
    const two = generateList(base());
    const four = generateList(base({ settings: { people: 4, weekStartsOn: 6 } }));
    expect(find(four.items, 'onion')!.needQty).toBeCloseTo(find(two.items, 'onion')!.needQty! * 2, 1);
    expect(find(four.items, 'onion')!.haveQty).toBe(find(two.items, 'onion')!.haveQty);
    expect(find(two.items, 'milk')!.buyQty).toBe(2);
    expect(find(four.items, 'milk')!.buyQty).toBe(4);
  });

  test('pantry lines contribute no quantity; only the low flag puts them on the list', () => {
    const out = generateList(base());
    expect(find(out.items, 'masala')).toMatchObject({ source: 'low', group: 'Running low' });
    expect(find(out.items, 'masala')!.buyQty).toBeUndefined();
    expect(find(out.items, 'rice')).toMatchObject({ source: 'low' });
    expect(find(out.items, 'dal')).toBeUndefined();
  });

  test('a weekly item is on the list even when no recipe uses it', () => {
    expect(find(generateList(base()).items, 'milk')).toMatchObject({ source: 'weekly', buyQty: 2 });
  });

  test('a missing bridge is reported, never silently dropped', () => {
    const noBridge = { ...I, onion: { ...I.onion, ozPerCup: undefined } };
    const out = generateList(base({ ingredients: noBridge }));
    expect(out.problems).toEqual([expect.objectContaining({ ingredientId: 'onion', reason: expect.stringContaining('ozPerCup') })]);
    expect(find(out.items, 'onion')).toBeUndefined();
  });

  test('days outside the window are ignored', () => {
    const out = generateList(base({ days: [{ date: '2026-09-20', breakfast: [], dinner: ['pav'] }], freshStock: [] }));
    expect(find(out.items, 'onion')).toBeUndefined();
    expect(find(out.items, 'cor')).toBeUndefined();
  });

  test('ordered by store visit order, running-low first inside a store, then aisle', () => {
    const out = generateList(base({ freshStock: [] }));
    const order = out.items.map((i) => i.storeId + ':' + i.group + ':' + i.name);
    expect(order.indexOf('costco:Produce:Yellow Onion')).toBeLessThan(order.indexOf('indian:Running low:Basmati Rice'));
    expect(order.indexOf('indian:Running low:Basmati Rice')).toBeLessThan(order.indexOf('indian:Produce:Coriander'));
    expect(order.indexOf('costco:Produce:Yellow Onion')).toBeLessThan(order.indexOf('costco:Dairy:Milk'));
  });

  test('a weight-bought ingredient sums in ounces and cross-checks in count', () => {
    const tomato = { ...I.onion, id: 'tomato', name: 'Tomato', buyUnit: 'lb' as const, stockUnit: 'each' as const };
    const R2 = { t: { id: 't', title: 'T', tags: [], steps: [], ingredients: [{ ingredientId: 'tomato', qty: 2, unit: 'cup' as const }] } };
    const out = generateList(base({ ingredients: { ...I, tomato }, recipes: R2, days: [{ date: '2026-09-05', breakfast: [], dinner: ['t'] }], freshStock: [{ ingredientId: 'tomato', qty: 2, unit: 'each' }] }));
    const t = find(out.items, 'tomato')!;
    expect(t.needUnit).toBe('oz'); expect(t.needQty).toBeCloseTo(22.4, 1); expect(t.haveQty).toBeCloseTo(10.6, 1);
    expect(t.buyUnit).toBe('lb'); expect(t.buyQty).toBeCloseTo(11.8 / 16, 1); expect(t.altUnit).toBe('each');
  });

  test('bunch quantities stay in bunches with no alternate', () => {
    const cor = find(generateList(base({ freshStock: [] })).items, 'cor')!;
    expect(cor.buyUnit).toBe('bunch'); expect(cor.buyQty).toBe(1); expect(cor.altUnit).toBeUndefined();
  });
});

describe('pantry check', () => {
  test('lists every pantry ingredient the week cooks with, low or not, and nothing it does not', () => {
    const out = generateList(base());
    // pav uses masala (low); nothing this week uses rice or dal
    expect(out.pantryCheck).toEqual([{ ingredientId: 'masala', name: 'Pav Bhaji Masala', storeId: 'indian', isLow: true }]);
    const withKhichdi = generateList(base({ recipes: { ...R, kh: { id: 'kh', title: 'Khichdi', tags: [], steps: [], ingredients: [{ ingredientId: 'rice', qty: 1, unit: 'cup' }, { ingredientId: 'dal', qty: 0.5, unit: 'cup' }] } }, days: [{ date: '2026-09-07', breakfast: [], dinner: ['kh'] }] }));
    expect(withKhichdi.pantryCheck.map((p) => [p.name, p.isLow])).toEqual([['Basmati Rice', true], ['Toor Dal', false]]);
    expect(find(withKhichdi.items, 'dal')).toBeUndefined(); // not low → reminder only, not on the list
  });
});

describe('mergeLists', () => {
  test('keeps ticks for items still present and carries manual items forward', () => {
    const old = [
      { ingredientId: 'onion', name: 'Yellow Onion', storeId: 'costco', group: 'Produce', source: 'auto' as const, checked: true },
      { ingredientId: 'gone', name: 'Gone', storeId: 'costco', group: 'Produce', source: 'auto' as const, checked: true },
      { ingredientId: 'candles', name: 'Birthday candles', storeId: 'costco', group: 'Bakery', source: 'manual' as const, checked: false },
    ];
    const fresh = [{ ingredientId: 'onion', name: 'Yellow Onion', storeId: 'costco', group: 'Produce', source: 'auto' as const, checked: false, buyQty: 1 }];
    const m = mergeLists(old, fresh);
    expect(m.find((i) => i.ingredientId === 'onion')).toMatchObject({ checked: true, buyQty: 1 });
    expect(m.find((i) => i.ingredientId === 'gone')).toBeUndefined();
    expect(m.find((i) => i.ingredientId === 'candles')).toBeDefined();
  });
});
