// The test database and secrets, shared by global-setup.ts and setup.ts.

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgresql://tradesura:tradesura@127.0.0.1:54320/tradesura_test?sslmode=disable";

/** Tests wipe tables, so they only ever run against a database on this machine. */
export function assertLocal(url: string) {
  const host = new URL(url).hostname;
  if (!["127.0.0.1", "localhost", "::1"].includes(host)) {
    throw new Error(`Refusing to run integration tests against ${host}: they wipe tables. Use the Docker database.`);
  }
}

export const TEST_ENV = {
  DATABASE_URL: TEST_DATABASE_URL,
  SESSION_SECRET: "integration-session-secret-integration-session-secret",
  ADMIN_API_SECRET: "integration-admin-api-secret-integration-admin-api-secret",
  TZ: "Europe/London",
  APP_URL: "http://localhost:3000",
} as const;
