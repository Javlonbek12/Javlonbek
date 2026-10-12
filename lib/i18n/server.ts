import { AsyncLocalStorage } from "node:async_hooks";

import { cache } from "react";

import { setLocaleResolver, type Locale } from "./index";

// The language of the current work on the server:
// - inside withLocale(...) (messages to a person, the bot, background jobs) — that language;
// - while rendering a page — the signed-in user's language (set by getCurrentUser).
const storage = new AsyncLocalStorage<Locale>();
const requestLocale = cache((): { locale?: Locale } => ({}));

export function withLocale<T>(locale: Locale, run: () => T): T {
  return storage.run(locale, run);
}

export function setRequestLocale(locale: Locale) {
  requestLocale().locale = locale;
}

setLocaleResolver(() => {
  const explicit = storage.getStore();
  if (explicit) return explicit;
  try {
    return requestLocale().locale;
  } catch {
    return undefined;
  }
});
