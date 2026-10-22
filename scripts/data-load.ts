// Loads data prepared outside the app from JSON on stdin:
//   { "connect": [ParsedRow…], "connectName": "…", "planograms": PlanogramBundle }
// On the server: GitHub → Actions → Server → data-load (the data travels encrypted, see the workflow).
import "dotenv/config";

import { db } from "@/lib/db";
import type { ParsedRow } from "@/modules/connect/parse";
import { importConnectRows } from "@/modules/connect/service";
import { withAccess } from "@/modules/core/access/actor";
import { loadPlanogramBundle } from "@/modules/planograms/bulk-load";

async function main() {
  let text = "";
  for await (const chunk of process.stdin) text += chunk;
  const data = JSON.parse(text) as {
    connect?: ParsedRow[];
    connectName?: string;
    planograms?: unknown;
  };
  // Changes are made on behalf of the first owner (the one who runs the system).
  const owner = await db.user.findFirst({
    where: { role: "OWNER" },
    orderBy: { createdAt: "asc" },
  });
  if (!owner) throw new Error("No owner yet");
  const actor = await withAccess(owner);
  if (data.connect?.length) {
    const sheets = await importConnectRows(owner.id, data.connectName ?? "data-load", data.connect);
    for (const s of sheets)
      console.log(`Connect ${s.kind}: new ${s.created}, updated ${s.updated}`);
  }
  if (data.planograms) {
    for (const line of await loadPlanogramBundle(actor, data.planograms))
      console.log(`Planograms ${line}`);
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
