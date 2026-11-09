import { en } from "./en";
import { ru } from "./ru";

// The shape of ru.ts with plain strings, so other languages can fill it.
type Strings<T> = { [K in keyof T]: T[K] extends string ? string : Strings<T[K]> };
export type Dictionary = Strings<typeof ru>;
// A dictionary that may leave keys out (Korean, see EXPORT_LOCALES).
export type PartialDictionary<T = Dictionary> = {
  [K in keyof T]?: T[K] extends string ? string : PartialDictionary<T[K]>;
};

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

// Languages a file can be downloaded in (Connect analytics): the interface languages and Korean.
// Korean is not an interface language. Its dictionary (lib/i18n/ko.ts) has only what the downloads
// use, a missing key is taken from English, and it is added on the server (lib/i18n/server.ts), so
// the browser never loads it. Inside withExportLocale("ko", …) t() and the Intl formats are Korean,
// while code that asks for a Locale (currentLocale) sees English.
export type ExportLocale = Locale | "ko";
export const EXPORT_LOCALES: ExportLocale[] = ["ru", "en", "ko"];

export const isExportLocale = (value: unknown): value is ExportLocale =>
  typeof value === "string" && (EXPORT_LOCALES as string[]).includes(value);

let korean: PartialDictionary | undefined;

export function setKoreanDictionary(dictionary: PartialDictionary) {
  korean = dictionary;
}

// Where the current language comes from. On the server it is set by lib/i18n/server.ts
// (the user's setting for this request, or the recipient of a message); client components
// pass their locale explicitly (see useT in components/locale-provider.tsx).
let resolveLocale: () => ExportLocale | undefined = () => undefined;

export function setLocaleResolver(resolver: () => ExportLocale | undefined) {
  resolveLocale = resolver;
}

// The language of the current work, Korean included (a download).
export function currentExportLocale(): ExportLocale {
  return resolveLocale() ?? defaultLocale;
}

// The interface language of the current work; English inside a Korean download.
export function currentLocale(): Locale {
  const locale = currentExportLocale();
  return locale === "ko" ? "en" : locale;
}

// For Intl date and number formatting.
const INTL_LOCALES: Record<ExportLocale, string> = { ru: "ru-RU", en: "en-GB", ko: "ko-KR" };
export const intlLocale = (locale: ExportLocale = currentExportLocale()) => INTL_LOCALES[locale];

function lookup(dictionary: object | undefined, key: string): string | undefined {
  let node: unknown = dictionary;
  for (const part of key.split(".")) {
    if (typeof node !== "object" || node === null || !(part in node)) {
      return undefined;
    }
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === "string" ? node : undefined;
}

export function t(
  key: TranslationKey,
  params?: Record<string, string | number>,
  locale: ExportLocale = currentExportLocale(),
): string {
  const text =
    (locale === "ko"
      ? (lookup(korean, key) ?? lookup(dictionaries.en, key))
      : lookup(dictionaries[locale], key)) ?? key;
  if (!params) {
    return text;
  }
  return text.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}

// Date formats in the current (or given) language, made once per language and options.
const dateFormats = new Map<string, Intl.DateTimeFormat>();
export function dateFormat(
  options: Intl.DateTimeFormatOptions,
  locale: ExportLocale = currentExportLocale(),
) {
  const key = `${locale}|${JSON.stringify(options)}`;
  let format = dateFormats.get(key);
  if (!format) {
    format = new Intl.DateTimeFormat(intlLocale(locale), options);
    dateFormats.set(key, format);
  }
  return format;
}
