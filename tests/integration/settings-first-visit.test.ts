// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import { getSettings } from "@/modules/core/settings/service";
import { createTestUser, resetDb } from "@/tests/helpers/db";

describe("settings on a person's first visit", () => {
  beforeEach(resetDb);

  it("two parallel reads both get the one new row", async () => {
    const user = await createTestUser("MEMBER");
    await db.userSettings.deleteMany({ where: { userId: user.id } });
    // A page reads the settings twice at once; both create, one loses on the unique key.
    const [a, b] = await Promise.all([getSettings(user.id), getSettings(user.id)]);
    expect(a.userId).toBe(user.id);
    expect(b.userId).toBe(user.id);
    expect(await db.userSettings.count({ where: { userId: user.id } })).toBe(1);
  });
});
