import { beforeEach, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import { runWatchdog, type WatchdogDeps } from "@/modules/ops/watchdog";
import { LAST_TICK_KEY } from "@/modules/scheduler/tick";
import { createTestUser, resetDb } from "@/tests/helpers/db";
import { telegramMock } from "@/tests/helpers/telegram";

const NOW = new Date("2026-10-05T06:00:00Z");
const healthyBot = { url: "https://example.test/api/telegram/webhook", pending_update_count: 0 };

const deps = (patch: Partial<WatchdogDeps> = {}): WatchdogDeps => ({
  now: NOW,
  appHealthy: async () => true,
  webhookInfo: async () => healthyBot,
  ...patch,
});

const tick = (minutesAgo: number) =>
  db.systemState.upsert({
    where: { key: LAST_TICK_KEY },
    create: {
      key: LAST_TICK_KEY,
      value: new Date(NOW.getTime() - minutesAgo * 60_000).toISOString(),
    },
    update: { value: new Date(NOW.getTime() - minutesAgo * 60_000).toISOString() },
  });

describe("watchdog", () => {
  beforeEach(async () => {
    await resetDb();
    telegramMock.mockClear();
  });

  it("is quiet when everything works", async () => {
    await createTestUser("OWNER");
    await tick(1);
    expect((await runWatchdog(deps())).size).toBe(0);
    expect(telegramMock).not.toHaveBeenCalled();
  });

  it("tells only the OWNER once when the scheduler stops, and again when it is back", async () => {
    const owner = await createTestUser("OWNER");
    await createTestUser("MANAGER");
    await tick(12);

    const problems = await runWatchdog(deps());
    expect([...problems.keys()]).toEqual(["scheduler"]);
    expect(telegramMock).toHaveBeenCalledTimes(1);
    expect(telegramMock.mock.calls[0][0]).toBe(owner.botChatId);
    expect(telegramMock.mock.calls[0][1]).toContain("планировщик");

    // Still broken five minutes later: no repeated message.
    await runWatchdog(deps({ now: new Date(NOW.getTime() + 5 * 60_000) }));
    expect(telegramMock).toHaveBeenCalledTimes(1);

    await tick(0);
    await runWatchdog(deps());
    expect(telegramMock).toHaveBeenCalledTimes(2);
    expect(telegramMock.mock.calls[1][1]).toContain("снова работает");
  });

  it("notices a dead site, a missing webhook, bot delivery errors and no Telegram", async () => {
    await createTestUser("OWNER");
    await tick(0);
    expect([...(await runWatchdog(deps({ appHealthy: async () => false }))).keys()]).toEqual([
      "app",
    ]);
    expect([
      ...(await runWatchdog(deps({ appHealthy: () => Promise.reject(new Error("down")) }))).keys(),
    ]).toEqual(["app"]);

    const noWebhook = await runWatchdog(
      deps({ webhookInfo: async () => ({ url: "", pending_update_count: 0 }) }),
    );
    expect(noWebhook.get("bot")).toContain("webhook");

    const failing = await runWatchdog(
      deps({
        webhookInfo: async () => ({
          ...healthyBot,
          pending_update_count: 3,
          last_error_date: NOW.getTime() / 1000 - 60,
          last_error_message: "Wrong response from the webhook: 502 Bad Gateway",
        }),
      }),
    );
    expect(failing.get("bot")).toContain("502");

    // An old error with an empty queue is not a problem any more.
    const old = await runWatchdog(
      deps({
        webhookInfo: async () => ({ ...healthyBot, last_error_date: NOW.getTime() / 1000 - 3600 }),
      }),
    );
    expect(old.size).toBe(0);

    expect((await runWatchdog(deps({ webhookInfo: async () => null }))).get("bot")).toContain(
      "Telegram",
    );
    // No bot token configured: the bot check is skipped.
    expect((await runWatchdog(deps({ webhookInfo: async () => undefined }))).size).toBe(0);
  });

  it("reports a scheduler that never ran", async () => {
    await createTestUser("OWNER");
    expect((await runWatchdog(deps())).get("scheduler")).toContain("ни разу");
  });
});
