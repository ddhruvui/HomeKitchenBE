// Live check of both Gemini calls, with the wall clock — the recipe draft is the one that once took three minutes.
// Costs a fraction of a cent. Run: npm run smoke:gemini -w api
import { draftRecipe, estimateBridges, makeGeminiGenerate } from '../src/gemini';
import { config } from '../src/env';

const timed = async <T>(label: string, work: Promise<T>): Promise<T> => {
  const t = Date.now();
  const out = await work;
  console.log(`${label}: ${((Date.now() - t) / 1000).toFixed(1)}s`);
  return out;
};

(async () => {
  console.log('model:', config.geminiModel, '· thinking:', config.geminiThinking || 'default');
  const bridges = await timed('bridges', estimateBridges([
    { id: 'onion', name: 'Yellow Onion', countUnit: 'each', wantCup: true, wantCount: true },
    { id: 'coriander', name: 'Coriander (cilantro)', countUnit: 'bunch', wantCup: true, wantCount: true },
  ], makeGeminiGenerate()));
  console.log(JSON.stringify(bridges, null, 2));
  const draft = await timed('recipe', draftRecipe('Pav Bhaji', makeGeminiGenerate()));
  console.log(`${draft.title}: ${draft.lines.length} ingredients, ${draft.steps.length} steps`);
  console.log(draft.lines.map((l) => `  ${l.qty ?? ''} ${l.unit ?? l.rawUnit ?? ''} ${l.name}`.trim()).join('\n'));
})().catch((e) => { console.error('FAILED:', e?.message ?? e); process.exit(1); });
