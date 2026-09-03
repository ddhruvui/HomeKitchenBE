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
  geminiModel: process.env.GEMINI_MODEL ?? 'gemini-3-flash-preview',
};
