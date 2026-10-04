// Real prompts against the real model: `npm run test:ai` (needs ANTHROPIC_API_KEY in .env).
// Not part of `npm test`, because it costs money and needs the internet.
import { beforeAll, describe, expect, it } from "vitest";

import { interpretCommand } from "@/modules/ai/prompts";
import { defaultDeps, handleText } from "@/modules/bot/conversation";
import { db } from "@/lib/db";
import type { DraftPayload } from "@/modules/bot/draft-card";
import { MEETING_DATE, MINUTES } from "@/tests/fixtures/minutes";
import { PHRASES, TODAY } from "@/tests/fixtures/phrases";
import { createMeeting, saveNotes } from "@/modules/meetings/service";
import { proposeActionItems } from "@/modules/meetings/minutes";
import { resetDb } from "@/tests/helpers/db";
import { createFixtureTeam } from "@/tests/helpers/team";

const NOW = new Date(`${TODAY}T09:00:00+05:00`);
let users: Awaited<ReturnType<typeof createFixtureTeam>>;

describe.skipIf(!process.env.ANTHROPIC_API_KEY)("live: text → tasks with Claude", () => {
  beforeAll(async () => {
    await resetDb();
    users = await createFixtureTeam();
  });

  it.each(PHRASES.map((p) => [p.lang, p.text, p] as const))(
    "[%s] %s",
    async (_lang, text, phrase) => {
      await db.botDraft.deleteMany();
      await handleText(users.owner, 9000001n, text, { ...defaultDeps, now: NOW });
      const draft = await db.botDraft.findFirstOrThrow();
      const tasks = (draft.payload as unknown as DraftPayload).tasks;
      expect(tasks).toHaveLength(phrase.expect.length);
      phrase.expect.forEach((expected, i) => {
        expect(tasks[i].assigneeId).toBe(
          expected.assignee === "me" ? null : users[expected.assignee].id,
        );
        expect(tasks[i].dueDate).toBe(expected.dueDate);
        if (expected.priority) expect(tasks[i].priority).toBe(expected.priority);
      });
    },
    60_000,
  );

  it.each([
    ["что у меня сегодня", "show_today"],
    ["bugun nima ishlarim bor", "show_today"],
    ["что просрочено?", "show_overdue"],
    ["что ждёт моего утверждения", "show_pending"],
    ["перенеси отчёт по остаткам на четверг", "reschedule"],
    ["закрой задачу отчёт", "complete"],
    ["hisobot tayyor", "complete"],
  ])(
    "intent: %s → %s",
    async (text, intent) => {
      const ctx = {
        today: TODAY,
        timezone: "Asia/Tashkent",
        speakerName: "Тестовый владелец",
        teamNames: [],
        projects: [],
      };
      const result = await interpretCommand(users.owner.id, text, ctx);
      expect(result.intent).toBe(intent);
      if (intent === "reschedule") expect(result.newDueDate).toBe("2026-10-08");
    },
    60_000,
  );
});

describe.skipIf(!process.env.ANTHROPIC_API_KEY)("live: meeting minutes → action items", () => {
  it.each(MINUTES.map((m, i) => [i + 1, m] as const))(
    "minutes example %i",
    async (_n, example) => {
      await resetDb();
      const team = await createFixtureTeam();
      const meeting = await createMeeting(team.owner, {
        title: "Планёрка",
        startsLocal: `${MEETING_DATE}T10:00`,
        durationMinutes: 60,
        agenda: "",
        link: "",
        participantIds: [team.aziz.id, team.dilnoza.id, team.sardor.id],
        repeatUntil: null,
      });
      await saveNotes(team.owner, meeting.id, example.text);
      const proposed = await proposeActionItems(team.owner, meeting.id);
      expect(proposed).toHaveLength(example.expect.length);
      example.expect.forEach((expected, i) => {
        expect(proposed[i].assigneeId).toBe(
          expected.assignee === "me" ? null : team[expected.assignee].id,
        );
        expect(proposed[i].dueDate).toBe(expected.dueDate);
      });
    },
    60_000,
  );
});
