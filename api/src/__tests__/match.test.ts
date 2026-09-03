import { matchIngredient, normalizeName, stems } from '../match';
import type { Ingredient } from '@home-kitchen/shared';

const ing = (name: string, kind: Ingredient['kind'] = 'fresh'): Ingredient => ({ id: name.toLowerCase().replace(/ /g, '-'), name, kind, storeId: 's', form: 'Produce' });
const catalog = [ing('Yellow Onion'), ing('Tomato'), ing('Potato'), ing('Sweet Potato'), ing('Coriander'), ing('Capsicum'), ing('Toor Dal', 'pantry'), ing('Paneer'), ing('Pav')];

describe('matching a drafted name to the catalog', () => {
  test('exact, whatever the case', () => { expect(matchIngredient('tomato', catalog)?.ingredient.name).toBe('Tomato'); });
  test('plurals', () => { expect(matchIngredient('Tomatoes', catalog)?.ingredient.name).toBe('Tomato'); expect(matchIngredient('Potatoes', catalog)?.ingredient.name).toBe('Potato'); });
  test('synonyms across kitchens', () => {
    expect(matchIngredient('Cilantro', catalog)?.ingredient.name).toBe('Coriander');
    expect(matchIngredient('green bell pepper', catalog)?.ingredient.name).toBe('Capsicum');
    expect(matchIngredient('Split Pigeon Peas', catalog)?.ingredient.name).toBe('Toor Dal');
    expect(matchIngredient('dinner rolls', catalog)?.ingredient.name).toBe('Pav');
  });
  test('the one catalog item containing the word is a partial match', () => {
    const m = matchIngredient('Onion', catalog);
    expect(m?.ingredient.name).toBe('Yellow Onion'); expect(m?.confidence).toBe('partial');
  });
  test('exact beats partial: "Potato" is Potato, not Sweet Potato', () => {
    expect(matchIngredient('Potato', catalog)).toMatchObject({ confidence: 'exact', ingredient: { name: 'Potato' } });
  });
  test('two candidates and no exact hit is nobody', () => {
    const cat = [ing('Red Chili Powder', 'pantry'), ing('Green Chili', 'pantry')];
    expect(matchIngredient('Chili', cat)).toBeNull();
  });
  test('nothing like it', () => { expect(matchIngredient('Saffron', catalog)).toBeNull(); expect(matchIngredient('', catalog)).toBeNull(); });
  test('normalization strips parentheticals and punctuation', () => { expect(normalizeName('Ginger-Garlic Paste (store bought)')).toBe('ginger garlic paste'); expect(stems('Bunches')).toContain('bunch'); });
});
