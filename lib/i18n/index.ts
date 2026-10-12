import { en } from "./en";
import { ru } from "./ru";

// The shape of ru.ts with plain strings, so other languages can fill it.
type Strings<T> = { [K in keyof T]: T[K] extends string ? string : Strings<T[K]> };
export type Dictionary = Strings<typeof ru>;

// Builds "a.b.c" keys for every string leaf of the dictionary.
type Paths<T> = {
  [K in keyof T & string]: T[K] extends string ? K : `${K}.${Paths<T[K]>}`;
}[keyof T & string];

export type TranslationKey = Paths<typeof ru>;

const dictionaries: Record<"ru" | "en", Dictionary> = { ru, en };

export type Locale = keyof typeof dictionaries;

export const LOCALES: Locale[] = ["ru", "en"];
export const defaultLocale: Locale = "ru";

export const isLocale = (value: unknown): value is Locale =>
  typeof value === "string" && (LOCALES as string[]).includes(value);

// Where the current language comes from. On the server it is set by lib/i18n/server.ts
// (the user's setting for this request, or the recipient of a message); client components
// pass their locale explicitly (see useT in components/locale-provider.tsx).
let resolveLocale: () => Locale | undefined = () => undefined;

export function setLocaleResolver(resolver: () => Locale | undefined) {
  resolveLocale = resolver;
}

export function currentLocale(): Locale {
  return resolveLocale() ?? defaultLocale;
}

// For Intl date and number formatting.
export const intlLocale = (locale: Locale = currentLocale()) =>
  locale === "en" ? "en-GB" : "ru-RU";

export function t(
  key: TranslationKey,
  params?: Record<string, string | number>,
  locale: Locale = currentLocale(),
): string {
  let node: unknown = dictionaries[locale];
  for (const part of key.split(".")) {
    if (typeof node !== "object" || node === null || !(part in node)) {
      return key;
    }
    node = (node as Record<string, unknown>)[part];
  }
  if (typeof node !== "string") {
    return key;
  }
  if (!params) {
    return node;
  }
  return node.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}

// Date formats in the current (or given) language, made once per language and options.
const dateFormats = new Map<string, Intl.DateTimeFormat>();
export function dateFormat(options: Intl.DateTimeFormatOptions, locale = currentLocale()) {
  const key = `${locale}|${JSON.stringify(options)}`;
  let format = dateFormats.get(key);
  if (!format) {
    format = new Intl.DateTimeFormat(intlLocale(locale), options);
    dateFormats.set(key, format);
  }
  return format;
}
