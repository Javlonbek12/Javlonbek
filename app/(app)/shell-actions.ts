"use server";

import { z } from "zod";

import { db } from "@/lib/db";
import { requireUser } from "@/modules/core/auth/current-user";
import { cleanPhoneBar } from "@/modules/core/registry";

const idsSchema = z.array(z.string().max(40)).max(30);

// «Ещё» → «Выбрать разделы для нижней панели»: the person's own sections for the phone's bottom
// bar (an empty list brings the default back). Returns what was stored.
export async function savePhoneBarAction(ids: string[]): Promise<string[]> {
  const user = await requireUser();
  const phoneBar = cleanPhoneBar(idsSchema.parse(ids));
  await db.user.update({ where: { id: user.id }, data: { phoneBar } });
  return phoneBar;
}
