export type TelegramButton = { text: string; data: string };

// Our button rows → Telegram's inline keyboard markup.
export function inlineKeyboard(buttons?: TelegramButton[][]) {
  if (!buttons || buttons.length === 0) return undefined;
  return {
    inline_keyboard: buttons.map((row) =>
      row.map((b) => ({ text: b.text, callback_data: b.data })),
    ),
  };
}
