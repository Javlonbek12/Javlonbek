import { describe, expect, it } from "vitest";

import { rememberedScope } from "./scope-cookie";

describe("remembered «Чьи» in the task list", () => {
  it("is read back for the same user only", () => {
    expect(rememberedScope("u1:team", "u1")).toBe("team");
    expect(rememberedScope(encodeURIComponent("u1:created"), "u1")).toBe("created");
    // Someone else signed in on this browser starts from the default.
    expect(rememberedScope("u2:team", "u1")).toBeUndefined();
    expect(rememberedScope(undefined, "u1")).toBeUndefined();
    expect(rememberedScope("%E0%A4%A", "u1")).toBeUndefined();
  });
});
