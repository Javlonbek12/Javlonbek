import { db } from "@/lib/db";
import type { Role } from "@/lib/generated/prisma/client";

export async function resetDb() {
  await db.$executeRawUnsafe(
    'TRUNCATE "EmployeeNote", "ScheduledSend", "SystemState", "AiUsage", "BotDraft", "ActivityLog", "Notification", "UserSettings", "Invite", "MeetingNotes", "MeetingParticipant", "TaskAttachment", "Comment", "TaskDependency", "Task", "Meeting", "Plan", "User" CASCADE',
  );
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
