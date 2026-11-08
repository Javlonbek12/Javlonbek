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
  appendNotes,
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
    expect(card.text).toContain("Итоги встречи «Планёрка» сохранены");
    const draft = await db.botDraft.findFirstOrThrow();
    expect((draft.payload as unknown as DraftPayload).meetingId).toBe(meeting.id);

    await handleCallback(users.owner, `d:${draft.id}:save`, deps);
    expect(await db.task.count({ where: { meetingId: meeting.id } })).toBe(3);
    expect((await db.meetingNotes.findFirstOrThrow()).text).toBe(MINUTES[0].text);
  });

  it("adds the bot's minutes below the existing ones and proposes tasks only from the new part", async () => {
    const users = await createFixtureTeam();
    const now = new Date(`${MEETING_DATE}T12:00:00+05:00`);
    const meeting = await createMeeting(users.owner, input({ participantIds: [users.aziz.id] }));
    await saveNotes(users.aziz, meeting.id, "Итоги с сайта");
    let seen = "";
    const deps: ConversationDeps = {
      now,
      interpret: async () => {
        throw new Error("not used");
      },
      extract: async () => [],
      extractActionItems: async (_u, text) => {
        seen = text;
        return [];
      },
    };
    await handleCallback(users.owner, `m:${meeting.id}`, deps);
    await handleText(
      users.owner,
      users.owner.telegramId,
      "Голосом: Азиз звонит дистрибьютору",
      deps,
    );
    const notes = await db.meetingNotes.findFirstOrThrow();
    expect(notes.text).toBe(
      "Итоги с сайта\n\n— Добавлено через бота: Тестовый владелец, 1 окт., 12:00 —\nГолосом: Азиз звонит дистрибьютору",
    );
    expect(seen).toBe("Голосом: Азиз звонит дистрибьютору");
  });
});

describe("minutes on the site", () => {
  beforeEach(resetDb);

  it("refuses to overwrite minutes someone saved after the editor was opened", async () => {
    const users = await createFixtureTeam();
    const meeting = await createMeeting(users.owner, input({ participantIds: [users.aziz.id] }));
    // Both open the empty minutes; the first save wins, the second is refused.
    await saveNotes(users.aziz, meeting.id, "Минутки Азиза", "");
    await expect(saveNotes(users.owner, meeting.id, "Мои минутки", "")).rejects.toMatchObject({
      code: "conflict",
    });
    const saved = await db.meetingNotes.findFirstOrThrow();
    expect(saved.text).toBe("Минутки Азиза");

    // Starting from the current version works; an old version is refused again.
    const version = saved.updatedAt.toISOString();
    await saveNotes(users.owner, meeting.id, "Минутки Азиза + мои", version);
    await expect(saveNotes(users.aziz, meeting.id, "Старое", version)).rejects.toMatchObject({
      code: "conflict",
    });
    expect((await db.meetingNotes.findFirstOrThrow()).text).toBe("Минутки Азиза + мои");

    // The bot never overwrites: it appends.
    await appendNotes(users.aziz, meeting.id, "Ещё пункт");
    expect((await db.meetingNotes.findFirstOrThrow()).text).toMatch(
      /^Минутки Азиза \+ мои\n\n— Добавлено через бота: Азиз Каримов, .+ —\nЕщё пункт$/,
    );
  });
});

describe("editing a meeting", () => {
  beforeEach(resetDb);

  it("tells participants about a new time, invites added people and reminds again at the new time", async () => {
    const users = await createFixtureTeam();
    const meeting = await createMeeting(users.owner, input({ participantIds: [users.aziz.id] }));
    const writeDigest = async () => "";
    await runSchedulerTick(new Date(meeting.startsAt.getTime() - 10 * 60_000), { writeDigest });
    expect(await db.notification.count({ where: { type: "meeting_reminder" } })).toBe(2);

    // Title only: nobody is bothered.
    await updateMeeting(
      users.owner,
      meeting.id,
      input({ title: "Планёрка (новая)", participantIds: [users.aziz.id] }),
    );
    expect(await db.notification.count({ where: { type: "meeting_invite" } })).toBe(1);

    // An hour later, with Dilnoza added.
    await updateMeeting(
      users.owner,
      meeting.id,
      input({
        startsLocal: `${MEETING_DATE}T11:00`,
        participantIds: [users.aziz.id, users.dilnoza.id],
      }),
    );
    const aziz = await db.notification.findMany({
      where: { userId: users.aziz.id, type: "meeting_invite" },
      orderBy: { createdAt: "asc" },
    });
    expect(aziz.map((n) => n.title)).toEqual([
      "📅 Приглашение на встречу",
      "📅 Встреча перенесена",
    ]);
    expect(aziz[1].body).toContain("11:00");
    expect(
      await db.notification.count({ where: { userId: users.dilnoza.id, type: "meeting_invite" } }),
    ).toBe(1);
    expect(
      await db.notification.count({ where: { userId: users.owner.id, type: "meeting_invite" } }),
    ).toBe(0);

    // The reminder for the new time is sent again (to all three).
    const moved = await db.meeting.findUniqueOrThrow({ where: { id: meeting.id } });
    await runSchedulerTick(new Date(moved.startsAt.getTime() - 10 * 60_000), { writeDigest });
    expect(await db.notification.count({ where: { type: "meeting_reminder" } })).toBe(5);
  });

  it("«this and following» moves the later occurrences by the same shift", async () => {
    const users = await createFixtureTeam();
    await createMeeting(users.owner, input({ repeatUntil: "2026-10-22" }));
    const all = await db.meeting.findMany({ orderBy: { startsAt: "asc" } });
    // From the 2nd occurrence on: a day later (Friday) at 15:30, with a new title.
    await updateMeeting(
      users.owner,
      all[1].id,
      input({ title: "Пятничная", startsLocal: "2026-10-09T15:30" }),
      true,
    );
    const after = await db.meeting.findMany({ orderBy: { startsAt: "asc" } });
    expect(after.map((m) => [m.title, m.startsAt.toISOString()])).toEqual([
      ["Планёрка", "2026-10-01T05:00:00.000Z"],
      ["Пятничная", "2026-10-09T10:30:00.000Z"],
      ["Пятничная", "2026-10-16T10:30:00.000Z"],
      ["Пятничная", "2026-10-23T10:30:00.000Z"],
    ]);
    // Only this one: the others stay.
    await updateMeeting(users.owner, all[3].id, input({ startsLocal: "2026-10-23T09:00" }));
    expect(
      (await db.meeting.findMany({ orderBy: { startsAt: "asc" } })).map((m) => m.title),
    ).toEqual(["Планёрка", "Пятничная", "Пятничная", "Планёрка"]);
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
