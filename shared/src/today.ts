import type { Ingredient, PlannedDay, Recipe, Settings, Unit } from './types';
import { SLOT_FACTOR } from './generate';
import { round } from './units';

export interface ScaledLine { ingredientId: string; name: string; qty?: number; unit?: Unit; note?: string; }
export interface ScaledRecipe { recipeId: string; title: string; factor: number; lines: ScaledLine[]; steps: string[]; }
export interface TodayView { date: string; people: number; breakfast: ScaledRecipe[]; lunch: string[]; dinner: ScaledRecipe[]; }

function scaleRecipe(r: Recipe, factor: number, ingredients: Record<string, Ingredient>): ScaledRecipe {
  return {
    recipeId: r.id, title: r.title, factor,
    lines: r.ingredients.map((l) => ({
      ingredientId: l.ingredientId,
      name: ingredients[l.ingredientId]?.name ?? '?',
      qty: l.qty === undefined ? undefined : round(l.qty * factor),
      unit: l.unit, note: l.note,
    })),
    steps: r.steps,
  };
}

/** §4 "Cooking from the plan": derived, never stored. Quantities stay in recipe units. */
export function todayView(day: PlannedDay | undefined, previousDay: PlannedDay | undefined, date: string,
  recipes: Record<string, Recipe>, ingredients: Record<string, Ingredient>, settings: Settings): TodayView {
  const scale = settings.people / 2;
  const pick = (ids: string[], factor: number) => ids.map((id) => recipes[id]).filter(Boolean).map((r) => scaleRecipe(r, factor, ingredients));
  return {
    date, people: settings.people,
    breakfast: pick(day?.breakfast ?? [], SLOT_FACTOR.breakfast * scale),
    lunch: (previousDay?.dinner ?? []).map((id) => recipes[id]?.title).filter((t): t is string => !!t),
    dinner: pick(day?.dinner ?? [], SLOT_FACTOR.dinner * scale),
  };
}
