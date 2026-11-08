import { t } from "@/lib/i18n";

// A button that answers the bot (callback data), and one that opens a page.
export type TelegramButton = { text: string; data: string };
export type LinkButton = { text: string; url: string; data?: undefined };
export type KeyboardButton = TelegramButton | LinkButton;

// Our button rows → Telegram's inline keyboard markup.
export function inlineKeyboard(buttons?: KeyboardButton[][]) {
  if (!buttons || buttons.length === 0) return undefined;
  return {
    inline_keyboard: buttons.map((row) =>
      row.map((b) =>
        "url" in b ? { text: b.text, url: b.url } : { text: b.text, callback_data: b.data },
      ),
    ),
  };
}

// «Открыть в приложении» under a message, instead of a long bare link. Telegram takes only real
// addresses for a link button (not localhost), so without https the link stays in the text: null.
export function openInAppRow(
  appUrl: string,
  path: string,
  text = t("bot.openInApp"),
): LinkButton[] | null {
  if (!appUrl.startsWith("https://")) return null;
  return [{ text, url: `${appUrl}${path}` }];
}

// Escapes text for Telegram's HTML formatting (the bot sends bold headers).
export const escapeHtml = (text: string) =>
  text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

export const bold = (text: string) => `<b>${escapeHtml(text)}</b>`;
