// The client wrapper around the SDK: thinking off, one budget for the whole call, and errors a person can act on.
const generateContent = jest.fn();
jest.mock('@google/genai', () => ({ GoogleGenAI: jest.fn(() => ({ models: { generateContent } })) }));

import { makeGeminiGenerate, ModelError } from '../gemini';
import { config } from '../env';

const err = (status: number, message: string) => Object.assign(new Error(message), { status });
const quota = (id: string, value: string) => [{ '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaId: id, quotaValue: value }] }];
const DAILY = 'GenerateRequestsPerDayPerProjectPerModel-FreeTier';
/** Most tests are about one model, so they pass no fallbacks; the chain has its own describe below. */
const only = (model: string) => makeGeminiGenerate('k', model, []);
const answer = (text: string) => ({ text });

beforeEach(() => { generateContent.mockReset(); });

describe('makeGeminiGenerate', () => {
  test('asks for minimal thinking — left on, a recipe draft costs ~60k thought tokens and three minutes', async () => {
    generateContent.mockResolvedValue(answer('{}'));
    await only('gemini-3.5-flash')('prompt');
    const cfg = generateContent.mock.calls[0][0].config;
    expect(cfg.thinkingConfig).toEqual({ thinkingLevel: 'MINIMAL' });
    expect(cfg.responseMimeType).toBe('application/json');
    expect(cfg.abortSignal).toBeInstanceOf(AbortSignal);
  });

  test('a model that refuses the thinking level is retried without it, not failed', async () => {
    generateContent.mockRejectedValueOnce(err(400, 'Thinking level MINIMAL is not supported for this model.')).mockResolvedValue(answer('ok'));
    expect((await only('gemini-3.8-flash')('p')).text).toBe('ok');
    expect(generateContent.mock.calls[0][0].config.thinkingConfig).toEqual({ thinkingLevel: 'MINIMAL' });
    expect(generateContent.mock.calls[1][0].config.thinkingConfig).toBeUndefined();
  });

  test('503 is retried; the call still answers', async () => {
    generateContent.mockRejectedValueOnce(err(503, 'high demand')).mockResolvedValue(answer('ok'));
    expect((await only(config.geminiModel)('p')).text).toBe('ok');
    expect(generateContent).toHaveBeenCalledTimes(2);
  });

  test('429 is not retried — the free tier says come back in 17s, which is longer than anyone waits', async () => {
    generateContent.mockRejectedValue(err(429, 'Quota exceeded for metric ... Please retry in 16.9s.'));
    await expect(only('gemini-3.5-flash')('p')).rejects.toThrow(/^The free Gemini quota for gemini-3.5-flash .* in 17s\.$/);
    expect(generateContent).toHaveBeenCalledTimes(1);
  });

  test('a daily cap says so, because "retry in 33s" would be a guaranteed second failure', async () => {
    const violation = { '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier', quotaValue: '20' }] };
    generateContent.mockRejectedValue(Object.assign(err(429, 'Quota exceeded. Please retry in 33s.'), { details: [violation] }));
    const reply = only('gemini-3.5-flash')('p');
    await expect(reply).rejects.toThrow(/used up for today \(20 a day\)/);
    await expect(reply).rejects.toThrow(/resets at midnight Pacific/);
    await expect(reply).rejects.not.toThrow(/in 33s/);
  });

  test('the per-minute cap still gets the wait it was given', async () => {
    const violation = { '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaId: 'GenerateRequestsPerMinutePerProjectPerModel-FreeTier', quotaValue: '10' }] };
    generateContent.mockRejectedValue(Object.assign(err(429, 'Quota exceeded. Please retry in 16.9s.'), { details: [violation] }));
    await expect(only('gemini-3.5-flash')('p')).rejects.toThrow(/used up for the minute — try again in 17s\.$/);
  });

  test('a hung model becomes a timeout message, not a spinner that never ends', async () => {
    generateContent.mockRejectedValue(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }));
    await expect(only(config.geminiModel)('p')).rejects.toThrow(new RegExp(`did not answer within ${Math.round(config.geminiTimeoutMs / 1000)}s`));
  });

  test('no key is an error before any call', () => { expect(() => makeGeminiGenerate('', 'm')).toThrow(/GEMINI_API_KEY/); });

  test('the messages a person reads are marked, so the route does not prefix them with "Gemini could not do that"', async () => {
    for (const e of [err(429, 'Quota exceeded. Please retry in 5s.'), err(503, 'high demand'), Object.assign(new Error('aborted'), { name: 'AbortError' })]) {
      generateContent.mockReset().mockRejectedValue(e);
      await expect(only(config.geminiModel)('p')).rejects.toBeInstanceOf(ModelError);
    }
    generateContent.mockReset().mockRejectedValue(err(400, 'API key not valid'));
    await expect(only(config.geminiModel)('p')).rejects.not.toBeInstanceOf(ModelError);
  });
});

describe('the fallback chain', () => {
  const chain = (model = 'main') => makeGeminiGenerate('k', model, ['alt-1', 'alt-2']);
  const modelOf = (call: number) => generateContent.mock.calls[call][0].model;

  test('a spent daily quota goes straight to a fallback, not back to the same model', async () => {
    generateContent
      .mockRejectedValueOnce(Object.assign(err(429, 'Quota exceeded.'), { details: quota(DAILY, '20') }))
      .mockResolvedValue(answer('from the fallback'));
    const out = await chain()('p');
    expect(out).toEqual({ text: 'from the fallback', model: 'alt-1' });
    // two calls, not three: retrying a model whose day is spent cannot work
    expect(generateContent).toHaveBeenCalledTimes(2);
    expect([modelOf(0), modelOf(1)]).toEqual(['main', 'alt-1']);
  });

  test('a busy model is given one more go before the chain moves on', async () => {
    generateContent.mockRejectedValueOnce(err(503, 'high demand')).mockResolvedValue(answer('ok'));
    expect((await chain()('p')).model).toBe('main');
    expect([modelOf(0), modelOf(1)]).toEqual(['main', 'main']);
  });

  test('it walks the whole chain and reports every model it tried', async () => {
    generateContent.mockRejectedValue(Object.assign(err(429, 'Quota exceeded.'), { details: quota(DAILY, '20') }));
    await expect(chain()('p')).rejects.toThrow(/main, alt-1, alt-2/);
    expect(generateContent.mock.calls.map((c) => c[0].model)).toEqual(['main', 'alt-1', 'alt-2']);
  });

  test('an error every model would share stops at the first, rather than burning the chain', async () => {
    generateContent.mockRejectedValue(err(400, 'API key not valid'));
    await expect(chain()('p')).rejects.toThrow(/API key not valid/);
    expect(generateContent).toHaveBeenCalledTimes(1);
  });

  test('when a fallback is itself a dead id, the primary\'s problem is the one reported', async () => {
    generateContent
      .mockRejectedValueOnce(Object.assign(err(429, 'Quota exceeded.'), { details: quota(DAILY, '20') }))
      .mockRejectedValue(err(404, 'models/alt-1 is no longer available to new users'));
    // the 404 is a fact about our config; the thing the user can act on is that the day's quota is gone
    await expect(chain()('p')).rejects.toThrow(/used up for today \(20 a day\)/);
  });

  test('a fallback equal to the main model is not tried twice over', async () => {
    generateContent.mockResolvedValue(answer('ok'));
    await makeGeminiGenerate('k', 'alt-1', ['alt-1', 'alt-2'])('p');
    expect(modelOf(0)).toBe('alt-1');
  });
});
