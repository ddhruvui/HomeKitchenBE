import type { Ingredient, RecipeLine } from './types';
import { familyOf, isUnit, missingBridge, baseUnitOf } from './units';

/** Returns an error message, or null when the line is acceptable. Enforced at recipe-save time (§12 G). */
export function validateRecipeLine(line: RecipeLine, ing: Ingredient | undefined): string | null {
  if (!ing) return 'unknown ingredient';
  if (line.qty !== undefined && !(Number.isFinite(line.qty) && line.qty > 0)) return 'quantity must be a positive number';
  if (line.unit !== undefined && !isUnit(line.unit)) return `unknown unit ${String(line.unit)}`;
  if ((line.qty === undefined) !== (line.unit === undefined)) return 'quantity and unit go together';
  if (ing.kind !== 'fresh' || !line.unit) return null;
  if (familyOf(line.unit) === 'count' && line.unit !== ing.countUnit) {
    return ing.countUnit ? `${ing.name} is counted in ${ing.countUnit}, not ${line.unit}` : `${ing.name} has no count unit`;
  }
  return null;
}

/** Which bridge (if any) this fresh ingredient still needs for a recipe line in `unit` to be totalled. */
export function bridgeNeededFor(ing: Ingredient, unit: RecipeLine['unit']): 'ozPerCup' | 'ozPerCount' | null {
  if (ing.kind !== 'fresh' || !unit || !ing.buyUnit) return null;
  return missingBridge(unit, baseUnitOf(ing.buyUnit), { ozPerCup: ing.ozPerCup, ozPerCount: ing.ozPerCount, countUnit: ing.countUnit });
}
