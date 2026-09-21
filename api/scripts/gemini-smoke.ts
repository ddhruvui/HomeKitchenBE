// Live check of the bridge call, with the wall clock. Costs a fraction of a cent. Run: npm run smoke:gemini -w api
import { estimateBridges, makeGeminiGenerate } from '../src/gemini';
import { config } from '../src/env';

const timed = async <T>(label: string, work: Promise<T>): Promise<T> => {
  const t = Date.now();
  const out = await work;
  console.log(`${label}: ${((Date.now() - t) / 1000).toFixed(1)}s`);
  return out;
};

(async () => {
  console.log('model:', config.geminiModel, '\u00b7 thinking:', config.geminiThinking || 'default');
  const bridges = await timed('bridges', estimateBridges([
    { id: 'onion', name: 'Yellow Onion', countUnit: 'each', wantCup: true, wantCount: true },
    { id: 'coriander', name: 'Coriander (cilantro)', countUnit: 'bunch', wantCup: true, wantCount: true },
  ], makeGeminiGenerate()));
  console.log(JSON.stringify(bridges, null, 2));
})().catch((e) => { console.error('FAILED:', e?.message ?? e); process.exit(1); });
