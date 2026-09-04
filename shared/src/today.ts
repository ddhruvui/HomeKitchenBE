import type { Ingredient, PlannedDay, Recipe, Settings, Unit } from './types';
import { SLOT_FACTOR } from './generate';
import { round } from './units';
import { cookAheadDate, cookedOn, lunchSourceDate } from './ekadashi';

export interface ScaledLine { ingredientId: string; name: string; qty?: number; unit?: Unit; note?: string; }
export interface ScaledRecipe { recipeId: string; title: string; factor: number; lines: ScaledLine[]; steps: string[]; }

export interface TodayInput {
  date: string;
  /** Must cover date − MAX_CARRY_LOOKBACK … date + 1. */
  days: PlannedDay[];
  /** Dates marked Ekadashi over the same range. */
  ekadashi: string[];
  recipes: Record<string, Recipe>;
  ingredients: Record<string, Ingredient>;
  settings: Settings;
}

export interface TodayView {
  date: string; people: number; isEkadashi: boolean;
  breakfast: ScaledRecipe[];
  lunch: string[]; lunchFrom: string | null;
  dinner: ScaledRecipe[]; dinnerCookedOn: string;
  cookAhead: { date: string; recipes: ScaledRecipe[] } | null;
}

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

/**
 * §4 "Cooking from the plan": derived, never stored. Quantities stay in recipe units. The fast day's
 * dish is still a ×2 dinner slot — it feeds that day's lunch and dinner instead of tonight and
 * tomorrow's lunch — so nothing here changes the amounts, only which evening does the cooking.
 */
export function todayView(input: TodayInput): TodayView {
  const { date, recipes, ingredients, settings } = input;
  const byDate = new Map(input.days.map((d) => [d.date, d]));
  const fast = new Set(input.ekadashi);
  const isEkadashi = (d: string) => fast.has(d);
  const scale = settings.people / 2;
  const pick = (ids: string[], factor: number) => ids.map((id) => recipes[id]).filter(Boolean).map((r) => scaleRecipe(r, factor, ingredients));
  const source = lunchSourceDate(date, isEkadashi);
  const lunch = (source === null ? [] : byDate.get(source)?.dinner ?? []).map((id) => recipes[id]?.title).filter((t): t is string => !!t);
  const ahead = cookAheadDate(date, isEkadashi);
  const aheadRecipes = ahead === null ? [] : pick(byDate.get(ahead)?.dinner ?? [], SLOT_FACTOR.dinner * scale);
  return {
    date, people: settings.people, isEkadashi: isEkadashi(date),
    breakfast: pick(byDate.get(date)?.breakfast ?? [], SLOT_FACTOR.breakfast * scale),
    lunch, lunchFrom: lunch.length > 0 && source !== null ? cookedOn(source, isEkadashi) : null,
    dinner: pick(byDate.get(date)?.dinner ?? [], SLOT_FACTOR.dinner * scale),
    dinnerCookedOn: cookedOn(date, isEkadashi),
    cookAhead: ahead !== null && aheadRecipes.length > 0 ? { date: ahead, recipes: aheadRecipes } : null,
  };
}
