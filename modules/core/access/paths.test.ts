import { describe, expect, it } from "vitest";

import { canOpenPath, sectionOfPath } from "./paths";

const member = (modules: string[]) => ({
  role: "MEMBER" as const,
  access: { modules, taskScope: "own" as const, teamIds: [] },
});

describe("links only to pages the person can open", () => {
  it("knows the section of a path", () => {
    expect(sectionOfPath("/meetings/abc?x=1")).toEqual(["meetings"]);
    expect(sectionOfPath("/team")).toEqual(["team"]);
    expect(sectionOfPath("/team/abc")).toEqual(["team", "structure"]);
    expect(sectionOfPath("/team/structure")).toEqual(["structure"]);
    expect(sectionOfPath("/content-analytics")).toEqual(["content"]);
    expect(sectionOfPath("/tasks/abc")).toBeNull();
    expect(sectionOfPath("/meetingsx")).toBeNull();
  });

  it("checks the person's sections", () => {
    expect(canOpenPath(member([]), "/meetings/abc")).toBe(false);
    expect(canOpenPath(member(["meetings"]), "/meetings/abc")).toBe(true);
    expect(canOpenPath(member(["structure"]), "/team/abc")).toBe(true);
    expect(canOpenPath(member(["structure"]), "/team")).toBe(false);
    expect(canOpenPath(member([]), "/tasks/abc")).toBe(true);
    expect(canOpenPath({ role: "OWNER" }, "/reports")).toBe(true);
  });
});
