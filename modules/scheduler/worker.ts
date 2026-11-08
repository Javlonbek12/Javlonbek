// Background worker: runs the scheduler every minute through pg-boss (a job queue
// stored in PostgreSQL). Start with `npm run worker` next to the web app.
import "dotenv/config";

import { PgBoss } from "pg-boss";

import { getEnv } from "@/lib/env";
import { freezeOrdered } from "@/modules/distribution/service";

import { runSchedulerTick } from "./tick";

export const TICK_QUEUE = "scheduler-tick";

export async function startWorker(connectionString = getEnv().DATABASE_URL) {
  const boss = new PgBoss(connectionString);
  boss.on("error", (error) => console.error("pg-boss error", error));
  await boss.start();
  await boss.createQueue(TICK_QUEUE);
  // pg-boss makes sure only one worker runs each minute's job, even with several instances.
  await boss.schedule(TICK_QUEUE, "* * * * *");
  await boss.work(TICK_QUEUE, async () => {
    await runSchedulerTick(new Date());
  });
  return boss;
}

async function main() {
  const boss = await startWorker();
  console.log("Scheduler worker started (every minute).");
  // Campaigns ordered before the split was frozen keep the split they have today, so a new
  // equipment file after a deploy doesn't move their plan. Done once per start; harmless to repeat.
  await freezeOrdered().catch((error) => console.error("Freezing ordered campaigns failed", error));
  const shutdown = async () => {
    await boss.stop({ graceful: true });
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

if (process.argv[1]?.endsWith("worker.ts")) void main();
