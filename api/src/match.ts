import type { Ingredient } from '@home-kitchen/shared';

/** Names that mean the same thing on two sides of the Atlantic, or in two kitchens. Applied to both the query and the catalog. */
const ALIASES: Record<string, string> = {
  cilantro: 'coriander', 'coriander leaves': 'coriander', 'fresh coriander': 'coriander', dhania: 'coriander',
  'bell pepper': 'capsicum', 'green bell pepper': 'capsicum', 'green pepper': 'capsicum', 'red bell pepper': 'capsicum',
  scallion: 'green onion', 'spring onion': 'green onion',
  'garbanzo bean': 'chickpea', 'chick pea': 'chickpea', 'kabuli chana': 'chickpea', chana: 'chickpea',
  'flattened rice': 'poha', 'beaten rice': 'poha', semolina: 'rava', sooji: 'rava', suji: 'rava',
  'gram flour': 'besan', 'chickpea flour': 'besan', 'clarified butter': 'ghee', 'whole wheat flour': 'atta flour', atta: 'atta flour',
  okra: 'bhindi', "lady's finger": 'bhindi', 'ladies finger': 'bhindi', eggplant: 'brinjal', aubergine: 'brinjal',
  'cottage cheese': 'paneer', 'indian cottage cheese': 'paneer', curd: 'yogurt', dahi: 'yogurt', 'plain yogurt': 'yogurt',
  'pigeon pea': 'toor dal', 'split pigeon pea': 'toor dal', arhar: 'toor dal', 'tur dal': 'toor dal',
  'fenugreek leaves': 'methi', 'fenugreek leaf': 'methi', 'dinner roll': 'pav', 'bread roll': 'pav', 'pav bread': 'pav',
  'green chilli': 'green chili', 'green chillies': 'green chili', 'green chilies': 'green chili',
};

export function normalizeName(s: string): string {
  return s.toLowerCase().replace(/\([^)]*\)/g, ' ').replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim();
}
function singular(w: string): string {
  if (w.length > 4 && /(ches|shes|sses|xes|zes|oes)$/.test(w)) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith('ies')) return w.slice(0, -3) + 'y';
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
  return w;
}
/** The canonical forms a name can take: normalized, singularized (last word), and aliased. */
export function stems(name: string): string[] {
  const n = normalizeName(name);
  const words = n.split(' ');
  const sing = [...words.slice(0, -1), singular(words[words.length - 1] ?? '')].join(' ');
  const out = new Set<string>();
  for (const v of [n, sing]) { out.add(v); const a = ALIASES[v]; if (a) out.add(a); }
  return [...out].filter(Boolean);
}

export interface Match { ingredient: Ingredient; confidence: 'exact' | 'partial'; }

/** Exact (after aliases and plurals) wins; otherwise the single catalog item that contains the name as a whole word, or vice versa. Never a guess between two. */
export function matchIngredient(name: string, ingredients: Ingredient[]): Match | null {
  const q = stems(name);
  if (q.length === 0) return null;
  const table = ingredients.map((ing) => ({ ing, st: stems(ing.name) }));
  const exact = table.find((t) => t.st.some((s) => q.includes(s)));
  if (exact) return { ingredient: exact.ing, confidence: 'exact' };
  const word = (hay: string, needle: string) => new RegExp(`(^| )${needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}( |$)`).test(hay);
  const partial = table.filter((t) => t.st.some((s) => q.some((qq) => word(s, qq) || word(qq, s))));
  return partial.length === 1 ? { ingredient: partial[0].ing, confidence: 'partial' } : null;
}
