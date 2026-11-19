// Responsibilities from the data on the server: proposes areas of responsibility for every active
// person from their team work and saves them as suggestions for the owner and managers to confirm
// («Команда» → «Обязанности»). Reads optional JSON from stdin: {"days": 60} (default: since the
// first data in the app). Prints counts only — the Actions logs are public.
// On the server: GitHub → Actions → Server → responsibilities-suggest.
import "dotenv/config";

import { db } from "@/lib/db";
import { AiError } from "@/modules/ai/run";
import { suggestResponsibilities, suggestSummary } from "@/modules/team/responsibility-suggest";

async function main() {
  let text = "";
  if (!process.stdin.isTTY) for await (const chunk of process.stdin) text += chunk;
  const parsed: unknown = text.trim() ? JSON.parse(text) : {};
  const days =
    typeof parsed === "object" && parsed && "days" in parsed && typeof parsed.days === "number"
      ? Math.max(1, Math.floor(parsed.days))
      : undefined;
  try {
    console.log(suggestSummary(await suggestResponsibilities({ days })));
  } catch (error) {
    if (error instanceof AiError && error.code === "not_configured") {
      console.error("ANTHROPIC_API_KEY is not set on the server: nothing written.");
      process.exitCode = 1;
      return;
    }
    throw error;
  }
}

main()
  .catch((error) => {
    // Our own messages are safe to show; a database error's text may quote the data, so only its
    // kind is printed.
    const own = error instanceof Error && error.constructor === Error;
    console.error(
      error instanceof AiError
        ? `AI error: ${error.code}`
        : `Failed: ${own ? error.message : error instanceof Error ? error.name : "unknown error"}`,
    );
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
