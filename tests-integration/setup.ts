import { assertLocal, TEST_ENV } from "./env";

// Runs in each test worker before the test file is imported, so lib/db.ts
// connects to the test database.
assertLocal(TEST_ENV.DATABASE_URL);
Object.assign(process.env, TEST_ENV);
