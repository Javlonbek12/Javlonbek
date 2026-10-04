import { beforeEach, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import {
  handleCallback,
  handleText,
  showMeetingsForNotes,
  type ConversationDeps,
} from "@/modules/bot/conversation";
import type { DraftPayload } from "@/modules/bot/draft-card";
import { proposeActionItems } from "@/modules/meetings/minutes";
import {
  createMeeting,
  deleteMeeting,
  getMeetingDetail,
  listMeetingsBetween,
  saveNotes,
  updateMeeting,
  type MeetingInput,
} from "@/modules/meetings/service";
import { runSchedulerTick } from "@/modules/scheduler/tick";
import { createProposedTasks } from "@/modules/tasks/batch";
import { MEETING_DATE, MINUTES } from "@/tests/fixtures/minutes";
import { resetDb } from "@/tests/helpers/db";
import { createFixtureTeam } from "@/tests/helpers/team";

const input = (overrides: Partial<MeetingInput> = {}): MeetingInput => ({
  title: "Планёрка",
  startsLocal: `${MEETING_DATE}T10:00`,
  durationMinutes: 60,
  agenda: "",
  link: "",
  participantIds: [],
  repeatUntil: null,
  ...overrides,
});

describe("meetings", () => {
  beforeEach(resetDb);

  it("stores the time in UTC from the creator's timezone and invites participants", async () => {
    const users = await createFixtureTeam();
    const meeting = await createMeeting(users.owner, input({ participantIds: [users.aziz.id] }));
    expect(meeting.startsAt.toISOString()).toBe("2026-10-01T05:00:00.000Z"); // 10:00 Tashkent
    const detail = await getMeetingDetail(users.owner, meeting.id);
    expect(detail!.meeting.participants.map((p) => p.userId).sort()).toEqual(
      [users.aziz.id, users.owner.id].sort(),
    );
    expect(
      await db.notification.count({ where: { userId: users.aziz.id, type: "meeting_invite" } }),
    ).toBe(1);
  });

  it("weekly meetings become separate occurrences; «this and following» deletes the rest", async () => {
    const users = await createFixtureTeam();
    const first = await createMeeting(users.owner, input({ repeatUntil: "2026-10-29" }));
    const all = await db.meeting.findMany({ orderBy: { startsAt: "asc" } });
    expect(all.map((m) => m.startsAt.toISOString().slice(0, 10))).toEqual([
      "2026-10-01",
      "2026-10-08",
      "2026-10-15",
      "2026-10-22",
      "2026-10-29",
    ]);
    expect(new Set(all.map((m) => m.seriesId)).size).toBe(1);
    expect(first.id).toBe(all[0].id);

    expect(await deleteMeeting(users.owner, all[2].id, true)).toBe(3);
    expect(await db.meeting.count()).toBe(2);
  });

  it("only participants, the creator and the OWNER see a meeting; only the creator/OWNER edit it", async () => {
    const users = await createFixtureTeam();
    const meeting = await createMeeting(users.aziz, input({ participantIds: [users.dilnoza.id] }));
    expect(await getMeetingDetail(users.sardor, meeting.id)).toBeNull();
    expect(await getMeetingDetail(users.owner, meeting.id)).not.toBeNull();
    await expect(
      updateMeeting(users.dilnoza, meeting.id, input({ title: "Взлом" })),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(saveNotes(users.sardor, meeting.id, "чужие минутки")).rejects.toMatchObject({
      code: "forbidden",
    });
    await expect(saveNotes(users.dilnoza, meeting.id, "Итоги")).resolves.toBeDefined();
  });

  it("lists meetings in a time range (calendar)", async () => {
    const users = await createFixtureTeam();
    await createMeeting(users.owner, input({ participantIds: [users.aziz.id] }));
    const october = await listMeetingsBetween(
      users.aziz,
      new Date("2026-10-01T00:00:00Z"),
      new Date("2026-11-01T00:00:00Z"),
      true,
    );
    expect(october).toHaveLength(1);
    const none = await listMeetingsBetween(
      users.sardor,
      new Date("2026-10-01T00:00:00Z"),
      new Date("2026-11-01T00:00:00Z"),
    );
    expect(none).toHaveLength(0);
  });
});

describe("minutes → tasks", () => {
  beforeEach(resetDb);

  it.each(MINUTES.map((m, i) => [i + 1, m] as const))("example %i", async (_n, example) => {
    const users = await createFixtureTeam();
    const meeting = await createMeeting(
      users.owner,
      input({ participantIds: [users.aziz.id, users.dilnoza.id, users.sardor.id] }),
    );
    await saveNotes(users.owner, meeting.id, example.text);

    let seenToday = "";
    const proposed = await proposeActionItems(users.owner, meeting.id, async (_u, _text, ctx) => {
      seenToday = ctx.today;
      return example.model;
    });
    // Relative dates in the minutes count from the meeting day.
    expect(seenToday).toBe(MEETING_DATE);
    expect(
      proposed.map((p) => [
        p.unresolved ? "?" : p.assigneeId === null ? "me" : p.assigneeId,
        p.dueDate,
      ]),
    ).toEqual(
      example.expect.map((e) => [e.assignee === "me" ? "me" : users[e.assignee].id, e.dueDate]),
    );

    const { saved } = await createProposedTasks(users.owner, proposed, meeting.id);
    expect(saved).toBe(example.expect.length);
    const detail = await getMeetingDetail(users.owner, meeting.id);
    expect(detail!.tasks).toHaveLength(example.expect.length);
  });

  it("needs saved minutes first", async () => {
    const users = await createFixtureTeam();
    const meeting = await createMeeting(users.owner, input());
    await expect(proposeActionItems(users.owner, meeting.id, async () => [])).rejects.toMatchObject(
      { code: "noNotes" },
    );
  });
});

describe("minutes via the bot (/notes)", () => {
  beforeEach(resetDb);

  it("choose a meeting → send minutes → confirm tasks linked to the meeting", async () => {
    const users = await createFixtureTeam();
    const now = new Date(`${MEETING_DATE}T12:00:00+05:00`);
    const meeting = await createMeeting(
      users.owner,
      input({ participantIds: [users.aziz.id, users.dilnoza.id] }),
    );
    const deps: ConversationDeps = {
      now,
      interpret: async () => {
        throw new Error("the minutes must not go through the normal pipeline");
      },
      extract: async () => [],
      extractActionItems: async () => MINUTES[0].model,
    };

    const list = await showMeetingsForNotes(users.owner, now);
    expect(list.buttons![0][0].data).toBe(`m:${meeting.id}`);
    expect((await handleCallback(users.owner, `m:${meeting.id}`, deps)).text).toContain(
      "Пришлите текст",
    );

    const card = await handleText(users.owner, users.owner.telegramId, MINUTES[0].text, deps);
    expect(card.text).toContain("Минутки встречи «Планёрка» сохранены");
    const draft = await db.botDraft.findFirstOrThrow();
    expect((draft.payload as unknown as DraftPayload).meetingId).toBe(meeting.id);

    await handleCallback(users.owner, `d:${draft.id}:save`, deps);
    expect(await db.task.count({ where: { meetingId: meeting.id } })).toBe(3);
    expect((await db.meetingNotes.findFirstOrThrow()).text).toBe(MINUTES[0].text);
  });
});

describe("meeting reminder", () => {
  beforeEach(resetDb);

  it("reminds every participant 15 minutes before, once", async () => {
    const users = await createFixtureTeam();
    const meeting = await createMeeting(
      users.owner,
      input({ participantIds: [users.aziz.id], link: "https://meet.example/abc" }),
    );
    const writeDigest = async () => "";
    await runSchedulerTick(new Date(meeting.startsAt.getTime() - 20 * 60_000), { writeDigest });
    expect(await db.notification.count({ where: { type: "meeting_reminder" } })).toBe(0);
    await runSchedulerTick(new Date(meeting.startsAt.getTime() - 14 * 60_000), { writeDigest });
    await runSchedulerTick(new Date(meeting.startsAt.getTime() - 13 * 60_000), { writeDigest });
    expect(await db.notification.count({ where: { type: "meeting_reminder" } })).toBe(2);
    const reminder = await db.notification.findFirstOrThrow({
      where: { userId: users.aziz.id, type: "meeting_reminder" },
    });
    expect(reminder.body).toContain("в 10:00");
    expect(reminder.body).toContain("https://meet.example/abc");
  });
});

it("deleting a meeting keeps its tasks", async () => {
  await resetDb();
  const users = await createFixtureTeam();
  const meeting = await createMeeting(users.owner, input());
  await saveNotes(users.owner, meeting.id, "x");
  await createProposedTasks(
    users.owner,
    [{ title: "Задача", assigneeId: null, dueDate: null, priority: null, project: null }],
    meeting.id,
  );
  await deleteMeeting(users.owner, meeting.id);
  expect(await db.task.count()).toBe(1);
});
