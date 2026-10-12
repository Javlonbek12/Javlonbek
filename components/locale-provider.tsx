"use client";

import { createContext, useCallback, useContext, type ReactNode } from "react";

import { defaultLocale, t, type Locale, type TranslationKey } from "@/lib/i18n";

// Client components get the viewer's language from here (the server sets it in the layout).
const LocaleContext = createContext<Locale>(defaultLocale);

export function LocaleProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  return <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>;
}

export const useLocale = () => useContext(LocaleContext);

// t() bound to the viewer's language.
export function useT() {
  const locale = useLocale();
  return useCallback(
    (key: TranslationKey, params?: Record<string, string | number>) => t(key, params, locale),
    [locale],
  );
}
