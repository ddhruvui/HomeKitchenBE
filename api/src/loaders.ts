import type { Ingredient, PlannedDay, Recipe, Settings, Store, FreshStockEntry } from '@home-kitchen/shared';
import { FreshStockModel, IngredientModel, PlannedDayModel, RecipeModel, SettingsModel, StoreModel } from './models';

const s = (v: unknown) => String(v);

export function toIngredient(d: Record<string, unknown>): Ingredient {
  const o = d as Record<string, unknown>;
  const out: Ingredient = { id: s(o._id ?? o.id), name: o.name as string, kind: o.kind as Ingredient['kind'], storeId: s(o.storeId), form: o.form as Ingredient['form'] };
  for (const k of ['weeklyQty', 'isLow', 'buyUnit', 'stockUnit', 'countUnit', 'ozPerCup', 'ozPerCount'] as const) {
    if (o[k] !== undefined && o[k] !== null) (out as unknown as Record<string, unknown>)[k] = o[k];
  }
  return out;
}
export function toRecipe(d: Record<string, unknown>): Recipe {
  const lines = (d.ingredients as Array<Record<string, unknown>>) ?? [];
  return {
    id: s(d._id ?? d.id), title: d.title as string, steps: (d.steps as string[]) ?? [], tags: (d.tags as string[]) ?? [],
    ingredients: lines.map((l) => ({ ingredientId: s(l.ingredientId), ...(l.qty != null ? { qty: l.qty as number } : {}), ...(l.unit ? { unit: l.unit as Recipe['ingredients'][number]['unit'] } : {}), ...(l.note ? { note: l.note as string } : {}) })),
  };
}
export function toStore(d: Record<string, unknown>): Store { return { id: s(d._id ?? d.id), name: d.name as string, sortOrder: d.sortOrder as number, color: d.color as string }; }
export function toPlannedDay(d: Record<string, unknown>): PlannedDay { return { date: d.date as string, breakfast: ((d.breakfast as unknown[]) ?? []).map(s), dinner: ((d.dinner as unknown[]) ?? []).map(s) }; }

export async function loadSettings(): Promise<Settings> {
  const doc = await SettingsModel.findById('settings').lean();
  return { people: (doc?.people as number) ?? 2, weekStartsOn: (doc?.weekStartsOn as number) ?? 6 };
}
export async function loadIngredientMap(): Promise<Record<string, Ingredient>> {
  const docs = await IngredientModel.find().lean();
  return Object.fromEntries(docs.map((d) => { const i = toIngredient(d as Record<string, unknown>); return [i.id, i]; }));
}
export async function loadRecipeMap(): Promise<Record<string, Recipe>> {
  const docs = await RecipeModel.find().lean();
  return Object.fromEntries(docs.map((d) => { const r = toRecipe(d as Record<string, unknown>); return [r.id, r]; }));
}
export async function loadStores(): Promise<Store[]> {
  return (await StoreModel.find().sort({ sortOrder: 1 }).lean()).map((d) => toStore(d as Record<string, unknown>));
}
export async function loadDays(start: string, end: string): Promise<PlannedDay[]> {
  return (await PlannedDayModel.find({ date: { $gte: start, $lte: end } }).lean()).map((d) => toPlannedDay(d as Record<string, unknown>));
}
export async function loadFreshStock(): Promise<FreshStockEntry[]> {
  return (await FreshStockModel.find().lean()).map((d) => ({ ingredientId: s(d.ingredientId), qty: d.qty as number, unit: d.unit as FreshStockEntry['unit'] }));
}
