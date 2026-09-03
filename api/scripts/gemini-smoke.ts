// Live check of the Gemini bridge estimation. Costs a fraction of a cent. Run: npm run smoke:gemini -w api
import { estimateBridges, makeGeminiGenerate } from '../src/gemini';
import { config } from '../src/env';

(async () => {
  console.log('model:', config.geminiModel);
  const out = await estimateBridges([
    { id: 'onion', name: 'Yellow Onion', countUnit: 'each', wantCup: true, wantCount: true },
    { id: 'coriander', name: 'Coriander (cilantro)', countUnit: 'bunch', wantCup: true, wantCount: true },
  ], makeGeminiGenerate());
  console.log(JSON.stringify(out, null, 2));
})().catch((e) => { console.error('FAILED:', e?.message ?? e); process.exit(1); });
