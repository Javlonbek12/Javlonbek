import "dotenv/config";

import { db } from "@/lib/db";

// Test data is added here stage by stage. Use obviously fake data only
// (e.g. "Тестовый сотрудник 1", "SKU-TEST-001").
async function main() {
  console.log("Seed: nothing to add yet (stage 0).");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
