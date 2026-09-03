import { convert, formatQty, missingBridge, MissingBridgeError, UnitMismatchError, familyOf, baseUnitOf, round } from '../units';

describe('within-family conversion', () => {
  test('weight', () => { expect(convert(2, 'lb', 'oz')).toBe(32); expect(convert(8, 'oz', 'lb')).toBe(0.5); });
  test('volume chain tsp→tbsp→cup→gallon', () => {
    expect(convert(3, 'tsp', 'tbsp')).toBeCloseTo(1);
    expect(convert(16, 'tbsp', 'cup')).toBeCloseTo(1);
    expect(convert(1, 'gallon', 'cup')).toBeCloseTo(16);
    expect(convert(1, 'cup', 'floz')).toBe(8);
  });
  test('same unit is identity even for count', () => { expect(convert(3, 'bunch', 'bunch')).toBe(3); });
  test('each and bunch never convert', () => { expect(() => convert(1, 'each', 'bunch')).toThrow(UnitMismatchError); });
});

describe('crossing families through the bridges', () => {
  const onion = { ozPerCup: 5.6, ozPerCount: 5.3, countUnit: 'each' as const };
  test('cups of onion → ounces', () => { expect(convert(3.5, 'cup', 'oz', onion)).toBeCloseTo(19.6); });
  test('tbsp uses the same ozPerCup (1 tbsp = 1/16 cup)', () => { expect(convert(16, 'tbsp', 'oz', { ozPerCup: 3.8 })).toBeCloseTo(3.8); });
  test('onions → ounces → onions round-trips', () => {
    expect(convert(3, 'each', 'oz', onion)).toBeCloseTo(15.9);
    expect(convert(15.9, 'oz', 'each', onion)).toBeCloseTo(3);
  });
  test('cups → each goes through ounces', () => { expect(convert(3.5, 'cup', 'each', onion)).toBeCloseTo(19.6 / 5.3); });
  test('the worked example from the spec: short 3.7 oz is 0.7 onions', () => {
    const need = convert(3.5, 'cup', 'oz', onion), have = convert(3, 'each', 'oz', onion);
    expect(round(need - have, 1)).toBe(3.7);
    expect(round(convert(need - have, 'oz', 'each', onion), 1)).toBe(0.7);
  });
  test('missing ozPerCup is loud, not silent', () => {
    expect(() => convert(1, 'cup', 'oz', {})).toThrow(MissingBridgeError);
    expect(missingBridge('cup', 'oz', {})).toBe('ozPerCup');
    expect(missingBridge('cup', 'oz', { ozPerCup: 5 })).toBeNull();
  });
  test('count against the wrong count unit is a mismatch', () => {
    expect(() => convert(1, 'bunch', 'oz', { ozPerCount: 2.5, countUnit: 'each' })).toThrow(UnitMismatchError);
  });
  test('zero or negative bridge counts as missing', () => { expect(() => convert(1, 'cup', 'oz', { ozPerCup: 0 })).toThrow(MissingBridgeError); });
});

describe('helpers', () => {
  test('families and bases', () => {
    expect(familyOf('tbsp')).toBe('volume'); expect(familyOf('lb')).toBe('weight'); expect(familyOf('bunch')).toBe('count');
    expect(baseUnitOf('lb')).toBe('oz'); expect(baseUnitOf('cup')).toBe('floz'); expect(baseUnitOf('bunch')).toBe('bunch');
  });
  test('formatQty prints fractions a cook reads', () => {
    expect(formatQty(0.25)).toBe('¼'); expect(formatQty(1.5)).toBe('1½'); expect(formatQty(2)).toBe('2');
    expect(formatQty(0.375)).toBe('0.38'); expect(formatQty(2.75)).toBe('2¾'); expect(formatQty(1 / 3)).toBe('⅓');
  });
});
