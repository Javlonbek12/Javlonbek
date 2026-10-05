// Team check and fixes on the server: `team.ts check` prints who is in the app (roles, places,
// managers); `team.ts fix` reads JSON from stdin (see modules/team/admin.ts) and applies it.
// On the server: GitHub → Actions → Server → team-check / team-fix.
import "dotenv/config";

import { db } from "@/lib/db";
import { teamFix, teamReport } from "@/modules/team/admin";

async function main() {
  if (process.argv.includes("fix")) {
    let text = "";
    for await (const chunk of process.stdin) text += chunk;
    for (const line of await teamFix(JSON.parse(text || "{}"))) console.log(line);
  }
  console.log(await teamReport());
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
