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
  /** Flash models think by default, and on a prompt this small that is waste: the recipe draft we no longer ship once burned
   *  62,912 thought tokens over 192 seconds against 3 with thinking down. A density is no more a reasoning problem than that
   *  was, so we turn thinking down here too; MINIMAL is the floor Gemini 3 accepts. */
  geminiThinking: process.env.GEMINI_THINKING ?? 'MINIMAL',
  /** A call that has not answered by now never will in a way the browser is still waiting for. */
  geminiTimeoutMs: Number(process.env.GEMINI_TIMEOUT_MS ?? 30_000),
};
