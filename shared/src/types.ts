export type WeightUnit = 'oz' | 'lb';
export type VolumeUnit = 'tsp' | 'tbsp' | 'floz' | 'cup' | 'pint' | 'quart' | 'gallon';
export type CountUnit = 'each' | 'bunch';
export type Unit = WeightUnit | VolumeUnit | CountUnit;
export type UnitFamily = 'weight' | 'volume' | 'count';

export type IngredientKind = 'fresh' | 'weekly' | 'pantry';
export const FORMS = ['Produce', 'Dairy', 'Bakery', 'Frozen', 'Dry Goods', 'Spices', 'Liquid'] as const;
export type Form = (typeof FORMS)[number];

export interface Store { id: string; name: string; sortOrder: number; color: string; }

/** weekStartsOn uses JS getDay(): 0 = Sunday … 6 = Saturday. */
export interface Settings { people: number; weekStartsOn: number; }

export interface Ingredient {
  id: string;
  name: string;
  kind: IngredientKind;
  storeId: string;
  form: Form;
  weeklyQty?: number;
  isLow?: boolean;
  buyUnit?: Unit;
  stockUnit?: Unit;
  countUnit?: CountUnit;
  ozPerCup?: number;
  ozPerCount?: number;
  /** Pantry only, optional, YYYY-MM-DD. For review, never for arithmetic. */
  expiresOn?: string;
}

export interface RecipeLine { ingredientId: string; qty?: number; unit?: Unit; note?: string; }
export interface Recipe { id: string; title: string; ingredients: RecipeLine[]; steps: string[]; tags: string[]; }

/** date is YYYY-MM-DD. Lunch is never stored; it is the previous day's dinner. */
export interface PlannedDay { date: string; breakfast: string[]; dinner: string[]; }

export interface FreshStockEntry { ingredientId: string; qty: number; unit: Unit; }

export type ItemSource = 'auto' | 'weekly' | 'low' | 'manual';
export interface ShoppingItem {
  ingredientId: string;
  name: string;
  storeId: string;
  group: string;
  source: ItemSource;
  needQty?: number; needUnit?: Unit;
  haveQty?: number; haveUnit?: Unit;
  buyQty?: number; buyUnit?: Unit;
  altQty?: number; altUnit?: Unit;
  checked: boolean;
}
export interface GenerationProblem { ingredientId: string; name: string; reason: string; }
/** A pantry ingredient the week's recipes use. The ones not low are the "check the pantry" reminder (§2). */
export interface PantryCheckItem { ingredientId: string; name: string; storeId: string; isLow: boolean; }
export interface GeneratedList { startDate: string; endDate: string; items: ShoppingItem[]; problems: GenerationProblem[]; pantryCheck: PantryCheckItem[]; }
