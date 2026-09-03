import type {
  FreshStockEntry, GeneratedList, GenerationProblem, Ingredient, PantryCheckItem, PlannedDay, Recipe, Settings, ShoppingItem, Store, Unit,
} from './types';
import { FORMS } from './types';
import { baseUnitOf, convert, familyOf, MissingBridgeError, round, UnitMismatchError } from './units';
import { daysInRange } from './dates';

export interface GenerateInput {
  startDate: string;
  endDate: string;
  days: PlannedDay[];
  recipes: Record<string, Recipe>;
  ingredients: Record<string, Ingredient>;
  stores: Store[];
  freshStock: FreshStockEntry[];
  settings: Settings;
}

export const SLOT_FACTOR = { breakfast: 1, dinner: 2 } as const;

function bridgesOf(ing: Ingredient) { return { ozPerCup: ing.ozPerCup, ozPerCount: ing.ozPerCount, countUnit: ing.countUnit }; }

/** The cross-check unit for a fresh line: ounces for whole items, a count for weight-bought produce, nothing for bunches (§7). */
function altUnitFor(ing: Ingredient, buy: Unit): Unit | undefined {
  if (familyOf(buy) === 'count') return buy === 'each' && ing.ozPerCount ? 'oz' : undefined;
  if (familyOf(buy) === 'weight') return ing.countUnit && ing.ozPerCount ? ing.countUnit : undefined;
  return undefined;
}

/** §6. Pure: everything it needs comes in, a list and a problem report come out. */
export function generateList(input: GenerateInput): GeneratedList {
  const { ingredients, recipes, settings } = input;
  const scale = settings.people / 2;
  const problems: GenerationProblem[] = [];
  const seen = new Set<string>();
  const problem = (ing: Ingredient, reason: string) => {
    const key = ing.id + '|' + reason;
    if (seen.has(key)) return;
    seen.add(key);
    problems.push({ ingredientId: ing.id, name: ing.name, reason });
  };

  // 1–2. sum every fresh line into a bucket, in the ingredient's base unit
  const need = new Map<string, number>();
  const pantryUsed = new Set<string>();
  const byDate = new Map(input.days.map((d) => [d.date, d]));
  for (const date of daysInRange(input.startDate, input.endDate)) {
    const day = byDate.get(date);
    if (!day) continue;
    const slots: Array<[string[], number]> = [[day.breakfast, SLOT_FACTOR.breakfast], [day.dinner, SLOT_FACTOR.dinner]];
    for (const [recipeIds, slotFactor] of slots) {
      for (const rid of recipeIds) {
        const recipe = recipes[rid];
        if (!recipe) continue;
        for (const line of recipe.ingredients) {
          const ing = ingredients[line.ingredientId];
          if (ing?.kind === 'pantry') pantryUsed.add(ing.id);
          if (!ing || ing.kind !== 'fresh' || line.qty === undefined || !line.unit) continue;
          if (!ing.buyUnit) { problem(ing, 'no buy unit set'); continue; }
          const base = baseUnitOf(ing.buyUnit);
          try {
            const q = convert(line.qty * slotFactor * scale, line.unit, base, bridgesOf(ing));
            need.set(ing.id, (need.get(ing.id) ?? 0) + q);
          } catch (e) {
            if (e instanceof MissingBridgeError) problem(ing, `needs ${e.needs} to convert ${line.unit} into ${base}`);
            else if (e instanceof UnitMismatchError) problem(ing, e.message);
            else throw e;
          }
        }
      }
    }
  }

  // 3–4. subtract what is on hand, express the shortfall in the buy unit
  const items: ShoppingItem[] = [];
  const stockByIng = new Map<string, FreshStockEntry[]>();
  for (const s of input.freshStock) stockByIng.set(s.ingredientId, [...(stockByIng.get(s.ingredientId) ?? []), s]);

  for (const [id, needed] of need) {
    const ing = ingredients[id];
    const buy = ing.buyUnit as Unit;
    const base = baseUnitOf(buy);
    let onHand = 0;
    let stockOk = true;
    for (const s of stockByIng.get(id) ?? []) {
      try { onHand += convert(s.qty, s.unit, base, bridgesOf(ing)); }
      catch (e) {
        if (e instanceof MissingBridgeError || e instanceof UnitMismatchError) { problem(ing, `fridge entry in ${s.unit} cannot be compared: ${e.message}`); stockOk = false; }
        else throw e;
      }
    }
    if (!stockOk) continue;
    const short = Math.max(0, needed - onHand);
    if (short <= 1e-9) continue;
    const item: ShoppingItem = {
      ingredientId: id, name: ing.name, storeId: ing.storeId, group: ing.form, source: 'auto', checked: false,
      needQty: round(needed), needUnit: base, haveQty: round(onHand), haveUnit: base,
      buyQty: round(convert(short, base, buy, bridgesOf(ing))), buyUnit: buy,
    };
    const alt = altUnitFor(ing, buy);
    if (alt) { item.altQty = round(convert(short, base, alt, bridgesOf(ing))); item.altUnit = alt; }
    items.push(item);
  }

  // 5. weekly items, scaled; 6. everything marked low, name only
  for (const ing of Object.values(ingredients)) {
    if (ing.kind === 'weekly' && ing.weeklyQty !== undefined) {
      items.push({ ingredientId: ing.id, name: ing.name, storeId: ing.storeId, group: ing.form, source: 'weekly', checked: false, buyQty: round(ing.weeklyQty * scale) });
    } else if (ing.kind === 'pantry' && ing.isLow) {
      items.push({ ingredientId: ing.id, name: ing.name, storeId: ing.storeId, group: 'Running low', source: 'low', checked: false });
    }
  }

  // 7. every pantry ingredient the week cooks with — the reminder to go and look (§2)
  const pantryCheck: PantryCheckItem[] = [...pantryUsed].map((id) => ingredients[id]).map((ing) => ({ ingredientId: ing.id, name: ing.name, storeId: ing.storeId, isLow: !!ing.isLow })).sort((a, b) => a.name.localeCompare(b.name));

  // 8. store in visit order, running-low first within a store, then aisle order, then name
  const storeRank = new Map(input.stores.slice().sort((a, b) => a.sortOrder - b.sortOrder).map((s, i) => [s.id, i]));
  const groupRank = (g: string) => (g === 'Running low' ? -1 : (FORMS as readonly string[]).indexOf(g));
  items.sort((a, b) =>
    (storeRank.get(a.storeId) ?? 99) - (storeRank.get(b.storeId) ?? 99) ||
    groupRank(a.group) - groupRank(b.group) ||
    a.name.localeCompare(b.name));

  return { startDate: input.startDate, endDate: input.endDate, items, problems, pantryCheck };
}

/**
 * Merge a fresh generation into an existing list for the same week (§12 F):
 * items still present keep their checked state, manual items survive, everything else is replaced.
 */
export function mergeLists(existing: ShoppingItem[] | undefined, fresh: ShoppingItem[]): ShoppingItem[] {
  if (!existing) return fresh;
  const checked = new Map(existing.filter((i) => i.checked).map((i) => [i.ingredientId + '|' + i.source, true]));
  const merged = fresh.map((i) => (checked.has(i.ingredientId + '|' + i.source) ? { ...i, checked: true } : i));
  for (const m of existing) if (m.source === 'manual') merged.push(m);
  return merged;
}
