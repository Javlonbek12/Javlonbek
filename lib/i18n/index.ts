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

export function t(
  key: TranslationKey,
  params?: Record<string, string | number>,
  locale: Locale = defaultLocale,
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
