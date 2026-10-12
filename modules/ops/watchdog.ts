import { db } from "@/lib/db";
import { t } from "@/lib/i18n";
import { sendTelegramMessage } from "@/modules/bot/send";
import { LAST_TICK_KEY } from "@/modules/scheduler/tick";

// Minimal monitoring: checks the web app, the scheduler and the Telegram bot and tells
// every OWNER in Telegram when something breaks and when it works again.

export type Check = "app" | "scheduler" | "bot";

export type WebhookInfo = {
  url?: string;
  pending_update_count: number;
  last_error_date?: number;
  last_error_message?: string;
};

export type WatchdogDeps = {
  now: Date;
  // true when /api/health answers "ok".
  appHealthy: () => Promise<boolean>;
  // null = Telegram could not be reached; undefined = no bot token configured (skip the check).
  webhookInfo: () => Promise<WebhookInfo | null | undefined>;
};

const STATE_KEY = "watchdog.problems";
// The scheduler ticks every minute; a few missed minutes mean the worker is down.
export const SCHEDULER_STALE_MS = 5 * 60_000;
const RECENT_BOT_ERROR_MS = 10 * 60_000;

// Returns the current problems: check → human-readable description.
export async function findProblems(deps: WatchdogDeps): Promise<Map<Check, string>> {
  const problems = new Map<Check, string>();

  if (!(await deps.appHealthy().catch(() => false))) problems.set("app", t("watchdog.app"));

  const tick = await db.systemState.findUnique({ where: { key: LAST_TICK_KEY } });
  if (!tick) problems.set("scheduler", t("watchdog.schedulerNever"));
  else if (deps.now.getTime() - new Date(tick.value).getTime() > SCHEDULER_STALE_MS)
    problems.set(
      "scheduler",
      t("watchdog.scheduler", { since: tick.value.slice(0, 16).replace("T", " ") + " UTC" }),
    );

  const info = await deps.webhookInfo().catch(() => null);
  if (info === null) problems.set("bot", t("watchdog.telegram"));
  else if (info) {
    const recentError =
      info.last_error_date !== undefined &&
      deps.now.getTime() - info.last_error_date * 1000 < RECENT_BOT_ERROR_MS &&
      info.pending_update_count > 0;
    if (!info.url) problems.set("bot", t("watchdog.botWebhook"));
    else if (recentError)
      problems.set("bot", t("watchdog.botErrors", { error: info.last_error_message ?? "?" }));
  }
  return problems;
}

// Technical alerts go to the first owner only (who runs the system), not to a second owner.
async function notifyOwners(text: string) {
  const owner = await db.user.findFirst({
    where: { role: "OWNER", botChatId: { not: null } },
    orderBy: { createdAt: "asc" },
  });
  if (owner) await sendTelegramMessage(owner.botChatId!, text);
}

// One watchdog round. Only changes are reported (no message every 5 minutes while
// something stays broken). Returns the problems found.
export async function runWatchdog(deps: WatchdogDeps): Promise<Map<Check, string>> {
  const problems = await findProblems(deps);
  const saved = await db.systemState.findUnique({ where: { key: STATE_KEY } });
  const before = new Set<Check>(saved ? (JSON.parse(saved.value) as Check[]) : []);

  for (const [check, text] of problems) {
    if (!before.has(check)) await notifyOwners(t("watchdog.down", { what: text }));
  }
  for (const check of before) {
    if (!problems.has(check))
      await notifyOwners(t("watchdog.up", { what: t(`watchdog.names.${check}`) }));
  }

  const value = JSON.stringify([...problems.keys()]);
  await db.systemState.upsert({
    where: { key: STATE_KEY },
    create: { key: STATE_KEY, value },
    update: { value },
  });
  return problems;
}
