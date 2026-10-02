import { vi } from "vitest";

import { sendTelegramMessage } from "@/modules/bot/send";

// The mocked Telegram sender from vitest.setup.ts.
export const telegramMock = vi.mocked(sendTelegramMessage);
