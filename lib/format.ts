import { currentLocale, intlLocale, t, type Locale, type TranslationKey } from "@/lib/i18n";

// Number formats in the current (or given) language, made once per language and options.
const numberFormats = new Map<string, Intl.NumberFormat>();
function numberFormat(options: Intl.NumberFormatOptions, locale: Locale) {
  const key = `${locale}|${JSON.stringify(options)}`;
  let format = numberFormats.get(key);
  if (!format) {
    format = new Intl.NumberFormat(intlLocale(locale), options);
    numberFormats.set(key, format);
  }
  return format;
}

// A number in the reader's language: «7,3» and «12 500» in Russian, «7.3» and «12,500» in English.
// Trailing zeros are dropped («7» not «7,0»).
export function formatNumber(value: number, maxDecimals = 1, locale = currentLocale()): string {
  return numberFormat({ maximumFractionDigits: maxDecimals }, locale).format(value);
}

// A share (0.173) as percent: «17 %» in Russian, «17%» in English.
export function formatPercent(share: number, maxDecimals = 0, locale = currentLocale()): string {
  return numberFormat({ style: "percent", maximumFractionDigits: maxDecimals }, locale).format(
    share,
  );
}

const pluralRules = new Map<Locale, Intl.PluralRules>();
const ORDER: Record<Locale, Intl.LDMLPluralRule[]> = {
  ru: ["one", "few", "many"],
  en: ["one", "other"],
};

// The form of a word that agrees with the number: «1 заявка», «3 заявки», «5 заявок».
// `forms` lists the forms split by "|": Russian one|few|many, English one|other; "{n}" in them
// becomes the number. A fraction in Russian takes the "few" form («1,5 заявки»).
export function plural(count: number, forms: string, locale = currentLocale()): string {
  let rules = pluralRules.get(locale);
  if (!rules) {
    rules = new Intl.PluralRules(intlLocale(locale));
    pluralRules.set(locale, rules);
  }
  const list = forms.split("|");
  const found = ORDER[locale].indexOf(rules.select(count));
  const index = found >= 0 ? found : locale === "ru" ? 1 : list.length - 1;
  const form = list[Math.min(index, list.length - 1)]!;
  return form.replaceAll("{n}", formatNumber(count, 1, locale));
}

// t() for a dictionary string with plural forms: tn("dist.requests", 5) → «5 заявок».
export function tn(
  key: TranslationKey,
  count: number,
  params?: Record<string, string | number>,
  locale = currentLocale(),
): string {
  return plural(count, t(key, params, locale), locale);
}
