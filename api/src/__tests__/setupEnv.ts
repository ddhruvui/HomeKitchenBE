import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(__dirname, '..', '..', '.env') });
// Tests must never touch production, whatever the .env says.
process.env.USE_TEST_DB = 'true';
