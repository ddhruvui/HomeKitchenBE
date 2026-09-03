import type { Unit, UnitFamily, WeightUnit, VolumeUnit, CountUnit } from './types';

export const WEIGHT_UNITS: readonly WeightUnit[] = ['oz', 'lb'];
export const VOLUME_UNITS: readonly VolumeUnit[] = ['tsp', 'tbsp', 'floz', 'cup', 'pint', 'quart', 'gallon'];
export const COUNT_UNITS: readonly CountUnit[] = ['each', 'bunch'];
export const ALL_UNITS: readonly Unit[] = [...WEIGHT_UNITS, ...VOLUME_UNITS, ...COUNT_UNITS];

const TO_OZ: Record<WeightUnit, number> = { oz: 1, lb: 16 };
const TO_FLOZ: Record<VolumeUnit, number> = { tsp: 1 / 6, tbsp: 0.5, floz: 1, cup: 8, pint: 16, quart: 32, gallon: 128 };

export const UNIT_LABEL: Record<Unit, string> = {
  oz: 'oz', lb: 'lb', tsp: 'tsp', tbsp: 'tbsp', floz: 'fl oz', cup: 'cup', pint: 'pint', quart: 'qt', gallon: 'gal', each: 'each', bunch: 'bunch',
};

export function isUnit(u: unknown): u is Unit { return typeof u === 'string' && (ALL_UNITS as readonly string[]).includes(u); }
export function isCountUnit(u: unknown): u is CountUnit { return typeof u === 'string' && (COUNT_UNITS as readonly string[]).includes(u); }

export function familyOf(u: Unit): UnitFamily {
  if ((WEIGHT_UNITS as readonly string[]).includes(u)) return 'weight';
  if ((VOLUME_UNITS as readonly string[]).includes(u)) return 'volume';
  return 'count';
}

/** The unit everything in a family is summed in: oz, fl oz, or the count unit itself. */
export function baseUnitOf(u: Unit): Unit {
  const f = familyOf(u);
  return f === 'weight' ? 'oz' : f === 'volume' ? 'floz' : u;
}

export interface Bridges { ozPerCup?: number; ozPerCount?: number; countUnit?: CountUnit; }

export class MissingBridgeError extends Error {
  constructor(public readonly from: Unit, public readonly to: Unit, public readonly needs: 'ozPerCup' | 'ozPerCount') {
    super(`no conversion from ${from} to ${to}: needs ${needs}`);
    this.name = 'MissingBridgeError';
  }
}
export class UnitMismatchError extends Error {
  constructor(msg: string) { super(msg); this.name = 'UnitMismatchError'; }
}

export function toBase(qty: number, unit: Unit): number {
  const f = familyOf(unit);
  if (f === 'weight') return qty * TO_OZ[unit as WeightUnit];
  if (f === 'volume') return qty * TO_FLOZ[unit as VolumeUnit];
  return qty;
}
export function fromBase(qtyBase: number, unit: Unit): number {
  const f = familyOf(unit);
  if (f === 'weight') return qtyBase / TO_OZ[unit as WeightUnit];
  if (f === 'volume') return qtyBase / TO_FLOZ[unit as VolumeUnit];
  return qtyBase;
}

function positive(n: number | undefined): n is number { return typeof n === 'number' && Number.isFinite(n) && n > 0; }

function baseToOz(base: number, from: Unit, b: Bridges): number {
  const f = familyOf(from);
  if (f === 'weight') return base;
  if (f === 'volume') {
    if (!positive(b.ozPerCup)) throw new MissingBridgeError(from, 'oz', 'ozPerCup');
    return (base * b.ozPerCup) / 8;
  }
  if (b.countUnit && b.countUnit !== from) throw new UnitMismatchError(`${from} is not this ingredient's count unit (${b.countUnit})`);
  if (!positive(b.ozPerCount)) throw new MissingBridgeError(from, 'oz', 'ozPerCount');
  return base * b.ozPerCount;
}
function ozToBase(oz: number, to: Unit, b: Bridges): number {
  const f = familyOf(to);
  if (f === 'weight') return oz;
  if (f === 'volume') {
    if (!positive(b.ozPerCup)) throw new MissingBridgeError('oz', to, 'ozPerCup');
    return (oz * 8) / b.ozPerCup;
  }
  if (b.countUnit && b.countUnit !== to) throw new UnitMismatchError(`${to} is not this ingredient's count unit (${b.countUnit})`);
  if (!positive(b.ozPerCount)) throw new MissingBridgeError('oz', to, 'ozPerCount');
  return oz / b.ozPerCount;
}

/**
 * Convert a quantity between any two units. Within weight or volume it is arithmetic;
 * across families it goes through ounces using the ingredient's bridges, and throws
 * MissingBridgeError when the needed bridge is absent — never silently.
 */
export function convert(qty: number, from: Unit, to: Unit, b: Bridges = {}): number {
  if (from === to) return qty;
  const ff = familyOf(from), tf = familyOf(to);
  if (ff === 'count' && tf === 'count') throw new UnitMismatchError(`${from} and ${to} do not convert`);
  if (ff === tf) return fromBase(toBase(qty, from), to);
  const oz = baseToOz(toBase(qty, from), from, b);
  return fromBase(ozToBase(oz, to, b), to);
}

/** True when converting `from` into `to` would need a bridge this ingredient lacks. */
export function missingBridge(from: Unit, to: Unit, b: Bridges): 'ozPerCup' | 'ozPerCount' | null {
  try { convert(1, from, to, b); return null; }
  catch (e) { return e instanceof MissingBridgeError ? e.needs : null; }
}

export function round(n: number, dp = 2): number { const m = 10 ** dp; return Math.round(n * m) / m; }

/** 0.25 → "¼", 1.5 → "1½", 2 → "2", 0.38 → "0.38". For cooks, not spreadsheets. */
export function formatQty(v: number): string {
  const w = Math.floor(v + 1e-9);
  const f = v - w;
  const near = (x: number, tol = 0.02) => Math.abs(f - x) < tol;
  let fr = '';
  if (near(0.25)) fr = '¼'; else if (near(0.5)) fr = '½'; else if (near(0.75)) fr = '¾';
  else if (near(1 / 3)) fr = '⅓'; else if (near(2 / 3)) fr = '⅔';
  if (fr) return (w > 0 ? String(w) : '') + fr;
  return String(round(v, 2));
}
