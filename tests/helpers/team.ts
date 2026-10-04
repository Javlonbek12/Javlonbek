import { db } from "@/lib/db";
import { TEAM } from "@/tests/fixtures/phrases";

// Creates the fixture team; returns users by key (owner, aziz, dilnoza, sardor).
export async function createFixtureTeam() {
  const users: Record<string, Awaited<ReturnType<typeof db.user.create>>> = {};
  for (const person of TEAM) {
    users[person.key] = await db.user.create({
      data: {
        firstName: person.firstName,
        lastName: person.lastName,
        telegramId: person.telegramId,
        botChatId: person.telegramId,
        role: person.role,
      },
    });
  }
  return users;
}
