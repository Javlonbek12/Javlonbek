import { describe, expect, it } from "vitest";

import { timezoneOptions, utcOffset } from "@/modules/core/settings/timezones";

import { NOTIFICATION_GROUPS, notificationGroupsFor } from "./groups";
import { OPTIONAL_NOTIFICATION_TYPES } from "./types";

describe("notification groups in Settings", () => {
  it("puts every switchable type in exactly one group", () => {
    const listed = NOTIFICATION_GROUPS.flatMap((g) => g.types);
    expect([...listed].sort()).toEqual([...OPTIONAL_NOTIFICATION_TYPES].sort());
  });

  it("shows only the groups that concern the person", () => {
    const member = {
      role: "MEMBER" as const,
      access: { modules: ["meetings"], taskScope: "own" as const, teamIds: [] },
    };
    expect(notificationGroupsFor(member).map((g) => g.id)).toEqual(["tasks", "meetings"]);
    const lawyer = {
      ...member,
      role: "LAWYER" as const,
      access: { ...member.access, modules: ["content"] },
    };
    expect(notificationGroupsFor(lawyer).map((g) => g.id)).toEqual(["tasks", "content", "lawyer"]);
    expect(notificationGroupsFor({ role: "OWNER" }).map((g) => g.id)).not.toContain("lawyer");
  });
});

describe("time zones", () => {
  it("lists common cities first with their offset, and keeps an unusual current zone", () => {
    const { common, all } = timezoneOptions("ru", "Etc/GMT-3", new Date("2026-11-08T00:00:00Z"));
    expect(common[0]).toEqual({ value: "Asia/Tashkent", label: "Ташкент — UTC+5" });
    expect(all.find((z) => z.value === "America/New_York")?.label).toBe(
      "New York (America) — UTC-5",
    );
    expect(all.some((z) => z.value === "Etc/GMT-3")).toBe(true);
    expect(utcOffset("UTC")).toBe("UTC");
  });
});
