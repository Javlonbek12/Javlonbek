import { afterAll, describe, expect, it } from "vitest";

import { GET } from "@/app/api/health/route";
import { db } from "@/lib/db";

// Needs a running PostgreSQL with the test database (see README).
describe("GET /api/health", () => {
  afterAll(async () => {
    await db.$disconnect();
  });

  it("reports that the app and the database are up", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok", database: "ok" });
  });
});
