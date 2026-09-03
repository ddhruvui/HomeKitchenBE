import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(__dirname, '..', '..', '.env') });
// Tests get their own throwaway database. Never production, and never the non-prod one you use day to day —
// the suite wipes every collection before each test.
process.env.USE_TEST_DB = 'true';
process.env.TEST_DB_NAME = 'HomeKitchenJestTest';
