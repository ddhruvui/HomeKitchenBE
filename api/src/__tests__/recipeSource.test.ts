// Parsing pages and vetting links. No network: the fetch is the one thing these tests stub.
import { buildSourcePrompt, buildUrlPrompt, buildVideoPrompt } from '../gemini';
import { checkUrl, fetchPage, isPrivateAddress, kindOf, parseJsonLdRecipe } from '../recipeSource';

const ld = (obj: unknown) => `<html><head><script type="application/ld+json">${JSON.stringify(obj)}</script></head><body>x</body></html>`;

describe('isPrivateAddress', () => {
  test('the API is open, so a link must not become a probe for the house network', () => {
    for (const h of ['localhost', 'foo.local', 'db.internal', '127.0.0.1', '10.1.2.3', '192.168.0.1', '172.20.0.5', '169.254.169.254', '0.0.0.0', '::1', 'fd00::1'])
      expect([h, isPrivateAddress(h)]).toEqual([h, true]);
    for (const h of ['example.com', '8.8.8.8', '172.15.0.1', '172.32.0.1', '93.184.216.34'])
      expect([h, isPrivateAddress(h)]).toEqual([h, false]);
  });
});

describe('checkUrl', () => {
  test('rejects what is not a fetchable public page, with a sentence a person can act on', async () => {
    await expect(checkUrl('not a url')).rejects.toThrow(/does not look like a link/);
    await expect(checkUrl('file:///etc/passwd')).rejects.toThrow(/only http and https/);
    await expect(checkUrl('http://127.0.0.1:3000/api/ingredients')).rejects.toThrow(/private network/);
    await expect(checkUrl('https://localhost/x')).rejects.toThrow(/private network/);
  });
  test('accepts an ordinary link', async () => {
    expect((await checkUrl(' https://example.com/pav-bhaji ')).hostname).toBe('example.com');
  });
});

describe('kindOf', () => {
  test('YouTube is watched, everything else is read', () => {
    for (const u of ['https://www.youtube.com/watch?v=abc', 'https://youtu.be/abc', 'https://m.youtube.com/watch?v=abc'])
      expect(kindOf(new URL(u))).toBe('video');
    expect(kindOf(new URL('https://www.indianhealthyrecipes.com/pav-bhaji-recipe/'))).toBe('web');
  });
});

describe('parseJsonLdRecipe', () => {
  test('reads the recipe a site already publishes, at any depth in the graph', () => {
    const r = parseJsonLdRecipe(ld({ '@graph': [{ '@type': 'WebPage' }, { '@type': ['Recipe', 'Thing'], name: 'Pav Bhaji', recipeYield: ['4'],
      recipeIngredient: ['2 large potatoes', '1 cup green peas'], recipeInstructions: [{ '@type': 'HowToStep', text: 'Boil the potatoes.' }, { '@type': 'HowToStep', text: 'Mash them.' }] }] }));
    expect(r).toEqual({ title: 'Pav Bhaji', servings: 4, ingredients: ['2 large potatoes', '1 cup green peas'], steps: ['Boil the potatoes.', 'Mash them.'] });
  });
  test('survives the shapes sites actually ship: sections, bare strings, HTML, junk blocks', () => {
    const r = parseJsonLdRecipe(
      '<script type="application/ld+json">{ not json </script>' +
      ld({ '@type': 'Recipe', name: 'Khichdi &amp; Kadhi', recipeYield: 'serves 6 people', recipeIngredient: ['<b>1 cup</b> rice'],
        recipeInstructions: [{ '@type': 'HowToSection', itemListElement: [{ '@type': 'HowToStep', text: 'Rinse the rice.' }] }] }));
    expect(r).toMatchObject({ title: 'Khichdi & Kadhi', servings: 6, ingredients: ['1 cup rice'], steps: ['Rinse the rice.'] });
  });
  test('a page with no recipe, or a recipe with no ingredients, is null — a normal outcome, not an error', () => {
    expect(parseJsonLdRecipe('<html><body>a blog post</body></html>')).toBeNull();
    expect(parseJsonLdRecipe(ld({ '@type': 'Recipe', name: 'Empty', recipeIngredient: [] }))).toBeNull();
  });
  test('an implausible yield is dropped rather than trusted', () => {
    expect(parseJsonLdRecipe(ld({ '@type': 'Recipe', recipeYield: '400', recipeIngredient: ['salt'] }))?.servings).toBeUndefined();
  });
});

describe('fetchPage', () => {
  const realFetch = global.fetch;
  afterEach(() => { global.fetch = realFetch; });
  test('a site that blocks robots says so in words', async () => {
    global.fetch = jest.fn(async () => new Response('nope', { status: 403 })) as unknown as typeof fetch;
    await expect(fetchPage(new URL('https://www.allrecipes.com/recipe/1/'))).rejects.toThrow(/allrecipes.com does not allow us to read/);
  });
  test('sends a browser user-agent, because a bare fetch is what gets blocked', async () => {
    const spy = jest.fn(async () => new Response('<html></html>', { status: 200 }));
    global.fetch = spy as unknown as typeof fetch;
    await fetchPage(new URL('https://example.com/r'));
    expect((spy.mock.calls[0] as unknown as [URL, RequestInit])[1].headers).toMatchObject({ 'user-agent': expect.stringMatching(/Mozilla/) });
  });
});

describe('source prompts', () => {
  test('a source that serves four is halved on the way in, and nothing is invented', () => {
    const p = buildSourcePrompt({ title: 'Pav Bhaji', servings: 4, ingredients: ['2 potatoes'], steps: ['Boil.'] }, 'indianhealthyrecipes.com');
    expect(p).toMatch(/The source serves 4\. Rescale every amount to TWO people/);
    expect(p).toMatch(/Use ONLY the ingredients below/);
    expect(p).toMatch(/- 2 potatoes/);
    expect(p).toMatch(/1\. Boil\./);
  });
  test('an unstated yield still says two people', () => {
    expect(buildSourcePrompt({ ingredients: ['x'], steps: [] }, 'site')).toMatch(/Amounts are for TWO people/);
  });
  test('reading a page and watching a video both forbid answering from memory', () => {
    expect(buildUrlPrompt('https://example.com/r')).toMatch(/from the page, not from memory/);
    expect(buildVideoPrompt()).toMatch(/from the video, not from memory/);
    expect(buildVideoPrompt()).toMatch(/list that component as ONE pantry ingredient/);
  });
});
