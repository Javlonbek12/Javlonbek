// The last «Чьи» chosen in the task list («Мои», «Поставленные мной», «Вся команда»), remembered
// in the browser: «<userId>:<scope>», so that someone else signing in on it starts from «Мои».
// The list's filter form writes it; the list and the board read it when the address has none.

export const SCOPE_COOKIE = "tasks.scope";

export function rememberedScope(value: string | undefined, userId: string): string | undefined {
  if (!value) return undefined;
  let text: string;
  try {
    text = decodeURIComponent(value);
  } catch {
    return undefined;
  }
  const at = text.lastIndexOf(":");
  if (at < 0 || text.slice(0, at) !== userId) return undefined;
  return text.slice(at + 1) || undefined;
}
