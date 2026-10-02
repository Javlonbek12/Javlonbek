import { ru } from "./ru";

export type Dictionary = typeof ru;

// Builds "a.b.c" keys for every string leaf of the dictionary.
type Paths<T> = {
  [K in keyof T & string]: T[K] extends string ? K : `${K}.${Paths<T[K]>}`;
}[keyof T & string];

export type TranslationKey = Paths<Dictionary>;

const dictionaries = { ru } as const;

export type Locale = keyof typeof dictionaries;

export const defaultLocale: Locale = "ru";

export function t(key: TranslationKey, locale: Locale = defaultLocale): string {
  let node: unknown = dictionaries[locale];
  for (const part of key.split(".")) {
    if (typeof node !== "object" || node === null || !(part in node)) {
      return key;
    }
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === "string" ? node : key;
}
