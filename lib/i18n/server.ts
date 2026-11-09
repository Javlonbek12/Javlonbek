import { AsyncLocalStorage } from "node:async_hooks";

import { cache } from "react";

import { setKoreanDictionary, setLocaleResolver, type ExportLocale, type Locale } from "./index";
import { ko } from "./ko";

// The language of the current work on the server:
// - inside withLocale(...) (messages to a person, the bot, background jobs) — that language;
// - inside withExportLocale(...) (a download in the language chosen for it, Korean too);
// - while rendering a page — the signed-in user's language (set by getCurrentUser).
const storage = new AsyncLocalStorage<ExportLocale>();
const requestLocale = cache((): { locale?: Locale } => ({}));

export function withLocale<T>(locale: Locale, run: () => T): T {
  return storage.run(locale, run);
}

// A file in one of EXPORT_LOCALES: t(), dates and numbers inside use it; in Korean, code that asks
// for a Locale (currentLocale) sees English, and a string missing in ko.ts is taken from English.
export function withExportLocale<T>(locale: ExportLocale, run: () => T): T {
  return storage.run(locale, run);
}

export function setRequestLocale(locale: Locale) {
  requestLocale().locale = locale;
}

setKoreanDictionary(ko);

setLocaleResolver(() => {
  const explicit = storage.getStore();
  if (explicit) return explicit;
  try {
    return requestLocale().locale;
  } catch {
    return undefined;
  }
});
