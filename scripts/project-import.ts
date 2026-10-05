// Loads a project plan from JSON on stdin (see modules/projects/import.ts for the format).
// On the server: GitHub → Actions → Server → project-import (paste the JSON into "data").
import "dotenv/config";

import { db } from "@/lib/db";
import { importProject } from "@/modules/projects/import";

async function main() {
  let text = "";
  for await (const chunk of process.stdin) text += chunk;
  const result = await importProject(JSON.parse(text));
  console.log(
    `Project loaded${result.replaced ? " (replaced)" : ""}: phases ${result.phases}, tasks ${result.tasks}, links ${result.links}, lead linked to an app user: ${result.leadLinked ? "yes" : "no (tasks assigned to the owner)"}.`,
  );
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
