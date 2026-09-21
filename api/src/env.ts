import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

/** USE_TEST_DB defaults to true: you have to say `false` out loud to touch production. */
export function resolveDbName(env: NodeJS.ProcessEnv = process.env): string {
  const flag = (env.USE_TEST_DB ?? 'true').trim().toLowerCase();
  const useTest = !(flag === 'false' || flag === '0' || flag === 'no');
  return useTest ? (env.TEST_DB_NAME || 'HomeKitchenTest') : (env.DB_NAME || 'HomeKitchen');
}

export function resolveMongoUri(env: NodeJS.ProcessEnv = process.env): string {
  const uri = env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is not set');
  return uri.replace('<db_password>', encodeURIComponent(env.DB_PASSWORD ?? ''));
}

export const config = {
  port: Number(process.env.PORT ?? 3000),
  geminiKey: process.env.GEMINI_API_KEY,
  geminiModel: process.env.GEMINI_MODEL ?? 'gemini-3.5-flash',
  /** Flash models think by default, and on the bridge prompt they burn ~60k thought tokens and three minutes on what takes four
   *  seconds without it. Estimating a density is not a reasoning problem, so we turn thinking down; MINIMAL is the floor Gemini 3 accepts. */
  geminiThinking: process.env.GEMINI_THINKING ?? 'MINIMAL',
  /** A call that has not answered by now never will in a way the browser is still waiting for. */
  geminiTimeoutMs: Number(process.env.GEMINI_TIMEOUT_MS ?? 30_000),
};
