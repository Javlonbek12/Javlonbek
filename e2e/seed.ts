// The e2e accounts (run by the global setup with tsx, before `prisma db seed`, which needs an owner
// for the demo planograms).
import { db } from "@/lib/db";

import { ACCOUNTS, assertTestDatabase } from "./env";

async function main() {
  assertTestDatabase(process.env.DATABASE_URL);
  for (const account of Object.values(ACCOUNTS)) {
    await db.user.create({
      data: {
        telegramId: BigInt(account.telegramId),
        firstName: account.firstName,
        role: "OWNER",
      },
    });
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
