import { db } from "@/lib/db";
import type { Role } from "@/lib/generated/prisma/client";
import { BUILT_IN_SECTIONS } from "@/modules/content/tagging";

export async function resetDb() {
  await db.$executeRawUnsafe(
    'TRUNCATE "DistShipment", "DistPosm", "DistReplacement", "DistCampaignFile", "DistCampaignElement", "DistPriceQuote", "DistOrder", "DistElementSize", "DistElement", "DistTypeSize", "DistUnit", "DistOutlet", "DistEquipmentCount", "DistPurchase", "DistPendingImport", "DistSeenOutlet", "DistSkippedRow", "ConnectRecord", "ConnectImport", "ContentComment", "ContentPost", "ProjectPhase", "Project", "PlanogramRule", "PlanogramSlot", "Planogram", "SkuPrice", "PriceList", "Responsibility", "OrgNode", "Posm", "Sku", "Equipment", "EmployeeNote", "ScheduledSend", "SystemState", "AiUsage", "BotDraft", "ActivityLog", "Notification", "UserSettings", "Invite", "MeetingNotes", "MeetingParticipant", "TaskAttachment", "Comment", "TaskDependency", "TaskStep", "TaskNote", "TaskCoAssigneeRequest", "TaskTimeEntry", "Task", "DeletedTask", "TaskSeries", "Meeting", "Plan", "User" CASCADE',
  );
  // Content sections: keep the eight built-in ones (seeded by the migration), drop the rest.
  await db.contentSection.deleteMany({ where: { id: { notIn: [...BUILT_IN_SECTIONS] } } });
  await db.contentSection.updateMany({ data: { archived: false } });
}

let nextTelegramId = 1000001n;

export async function createTestUser(
  role: Role,
  options: { firstName?: string; botChatId?: bigint | null } = {},
) {
  const telegramId = nextTelegramId++;
  return db.user.create({
    data: {
      telegramId,
      firstName: options.firstName ?? `Тестовый сотрудник ${telegramId - 1000000n}`,
      role,
      botChatId: options.botChatId === undefined ? telegramId : options.botChatId,
    },
  });
}

export function testProfile(telegramId: bigint, firstName = "Тестовый сотрудник") {
  return { telegramId, firstName };
}
