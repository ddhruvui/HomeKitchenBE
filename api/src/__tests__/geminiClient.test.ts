// The client wrapper around the SDK: thinking off, one budget for the whole call, and errors a person can act on.
const generateContent = jest.fn();
jest.mock('@google/genai', () => ({ GoogleGenAI: jest.fn(() => ({ models: { generateContent } })) }));

import { makeGeminiGenerate, ModelError } from '../gemini';
import { config } from '../env';

const err = (status: number, message: string) => Object.assign(new Error(message), { status });
const answer = (text: string) => ({ text });

beforeEach(() => { generateContent.mockReset(); });

describe('makeGeminiGenerate', () => {
  test('asks for minimal thinking — left on, a recipe draft costs ~60k thought tokens and three minutes', async () => {
    generateContent.mockResolvedValue(answer('{}'));
    await makeGeminiGenerate('k', 'gemini-3.5-flash')('prompt');
    const cfg = generateContent.mock.calls[0][0].config;
    expect(cfg.thinkingConfig).toEqual({ thinkingLevel: 'MINIMAL' });
    expect(cfg.responseMimeType).toBe('application/json');
    expect(cfg.abortSignal).toBeInstanceOf(AbortSignal);
  });

  test('a model that refuses the thinking level is retried without it, not failed', async () => {
    generateContent.mockRejectedValueOnce(err(400, 'Thinking level MINIMAL is not supported for this model.')).mockResolvedValue(answer('ok'));
    expect(await makeGeminiGenerate('k', 'gemini-3.8-flash')('p')).toBe('ok');
    expect(generateContent.mock.calls[0][0].config.thinkingConfig).toEqual({ thinkingLevel: 'MINIMAL' });
    expect(generateContent.mock.calls[1][0].config.thinkingConfig).toBeUndefined();
  });

  test('503 is retried; the call still answers', async () => {
    generateContent.mockRejectedValueOnce(err(503, 'high demand')).mockResolvedValue(answer('ok'));
    expect(await makeGeminiGenerate('k')('p')).toBe('ok');
    expect(generateContent).toHaveBeenCalledTimes(2);
  });

  test('429 is not retried — the free tier says come back in 17s, which is longer than anyone waits', async () => {
    generateContent.mockRejectedValue(err(429, 'Quota exceeded for metric ... Please retry in 16.9s.'));
    await expect(makeGeminiGenerate('k', 'gemini-3.5-flash')('p')).rejects.toThrow(/^The free Gemini quota for gemini-3.5-flash .* in 17s\.$/);
    expect(generateContent).toHaveBeenCalledTimes(1);
  });

  test('a hung model becomes a timeout message, not a spinner that never ends', async () => {
    generateContent.mockRejectedValue(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }));
    await expect(makeGeminiGenerate('k')('p')).rejects.toThrow(new RegExp(`did not answer within ${Math.round(config.geminiTimeoutMs / 1000)}s`));
  });

  test('no key is an error before any call', () => { expect(() => makeGeminiGenerate('', 'm')).toThrow(/GEMINI_API_KEY/); });

  test('the messages a person reads are marked, so the route does not prefix them with "Gemini could not do that"', async () => {
    for (const e of [err(429, 'Quota exceeded. Please retry in 5s.'), err(503, 'high demand'), Object.assign(new Error('aborted'), { name: 'AbortError' })]) {
      generateContent.mockReset().mockRejectedValue(e);
      await expect(makeGeminiGenerate('k')('p')).rejects.toBeInstanceOf(ModelError);
    }
    generateContent.mockReset().mockRejectedValue(err(400, 'API key not valid'));
    await expect(makeGeminiGenerate('k')('p')).rejects.not.toBeInstanceOf(ModelError);
  });
});
