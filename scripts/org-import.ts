// Loads an org chart from JSON on stdin (see modules/org/import.ts for the format).
// On the server: GitHub → Actions → Server → org-import (paste the JSON into "data").
import "dotenv/config";

import { db } from "@/lib/db";
import { importOrgChart } from "@/modules/org/import";

async function main() {
  let text = "";
  for await (const chunk of process.stdin) text += chunk;
  const stats = await importOrgChart(JSON.parse(text), {
    replace: process.argv.includes("--replace"),
  });
  console.log(
    `Org chart loaded: units ${stats.units}, people ${stats.people} (linked to app users: ${stats.linked}), vacancies ${stats.vacancies}.`,
  );
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
