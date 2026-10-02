import "@testing-library/jest-dom/vitest";

import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

afterEach(() => cleanup());

// Tests never talk to the real Telegram API.
vi.mock("@/modules/bot/send", () => ({
  sendTelegramMessage: vi.fn(async () => true),
}));
