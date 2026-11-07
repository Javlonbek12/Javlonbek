// Usage report on the server: who works in the app and which modules are alive, counts only.
// Reads optional JSON from stdin: {"days": 60} (default 30).
// On the server: GitHub → Actions → Server → usage.
import "dotenv/config";

import { db } from "@/lib/db";
import { DEFAULT_USAGE_DAYS, usageReport } from "@/modules/ops/usage";

async function main() {
  let text = "";
  if (!process.stdin.isTTY) for await (const chunk of process.stdin) text += chunk;
  const parsed: unknown = text.trim() ? JSON.parse(text) : {};
  const days =
    typeof parsed === "object" && parsed && "days" in parsed && typeof parsed.days === "number"
      ? Math.max(1, Math.floor(parsed.days))
      : DEFAULT_USAGE_DAYS;
  console.log(await usageReport(new Date(), days));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
