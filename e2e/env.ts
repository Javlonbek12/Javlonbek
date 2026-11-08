// Shared settings of the browser tests: where the app under test runs, its database and the
// test accounts (one per browser project, so the projects can run side by side).

export const PORT = 3400;
export const BASE_URL = `http://localhost:${PORT}`;

// A database of its own: it is wiped and filled again before every run.
export const DATABASE_URL =
  process.env.E2E_DATABASE_URL ??
  "postgresql://assistant:assistant@localhost:5432/assistant_e2e_test";

export type Account = { telegramId: string; firstName: string };

// Signed in through the dev login. Both are owners: the seed creates them, so neither needs an
// invitation.
export const ACCOUNTS = {
  desktop: { telegramId: "1000001", firstName: "Тестовый сотрудник 1" },
  phone: { telegramId: "1000002", firstName: "Тестовый сотрудник 2" },
} satisfies Record<string, Account>;

export type AccountName = keyof typeof ACCOUNTS;

// The signed-in browser state (session cookie) of an account, written by the global setup.
export const authFile = (name: AccountName) => `e2e/.auth/${name}.json`;

// Never wipe a real database: the name must end with "_test" (as for `npm test`).
export function assertTestDatabase(url: string | undefined) {
  const name = url ? new URL(url).pathname.slice(1) : "";
  if (!name.endsWith("_test")) {
    throw new Error(
      `Refusing to use "${name}" for e2e tests: the database name must end with "_test".`,
    );
  }
}
