import { execSync } from "node:child_process";

// Applies migrations to the test database once before all tests.
export default function setup() {
  const url =
    process.env.TEST_DATABASE_URL ??
    "postgresql://assistant:assistant@localhost:5432/assistant_test";
  const dbName = new URL(url).pathname.slice(1);
  if (!dbName.endsWith("_test")) {
    throw new Error(
      `Refusing to run tests against "${dbName}": the test database name must end with "_test".`,
    );
  }
  execSync("npx prisma migrate deploy", {
    env: { ...process.env, DATABASE_URL: url },
    stdio: "pipe",
  });
}
