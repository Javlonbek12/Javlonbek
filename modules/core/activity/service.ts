import { db } from "@/lib/db";
import type { Prisma } from "@/lib/generated/prisma/client";

export type ActivityEntry = {
  actorId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  details?: Prisma.InputJsonValue;
};

// Records who changed what. Pass a transaction client to log inside a transaction.
export async function logActivity(entry: ActivityEntry, client: Prisma.TransactionClient = db) {
  await client.activityLog.create({ data: entry });
}
