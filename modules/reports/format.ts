import { fromDateString } from "@/lib/dates";
import { currentLocale, intlLocale, t, type Locale, type TranslationKey } from "@/lib/i18n";

// Numbers and periods in words for reports, Connect and the content plan: a decimal comma in
// Russian, plurals that agree («1 пост», «3 поста», «5 постов») and date ranges with the year
// only when it isn't this one.

// A number with up to `digits` decimals: «7,3» in Russian, «7.3» in English.
export const formatDecimal = (value: number, digits = 1, locale: Locale = currentLocale()) =>
  new Intl.NumberFormat(intlLocale(locale), { maximumFractionDigits: digits }).format(value);

// The number and the word that agrees with it: «1 пост», «3 поста», «5 постов», «1,5 дня».
// The dictionary keeps the word's forms separated by «|»: Russian «one|few|many»
// («пост|поста|постов»), English «one|other» («post|posts»).
export function plural(key: TranslationKey, count: number, locale: Locale = currentLocale()) {
  return `${formatDecimal(count, 1, locale)} ${pluralWord(key, count, locale)}`;
}

// Only the word, for phrases where the number stands elsewhere.
export function pluralWord(key: TranslationKey, count: number, locale: Locale = currentLocale()) {
  const forms = t(key, undefined, locale).split("|");
  const rule = new Intl.PluralRules(intlLocale(locale)).select(count);
  // Russian fractions («1,5 дня») take the «few» form, like English «other» takes the second.
  const index = rule === "one" ? 0 : rule === "many" && forms.length > 2 ? 2 : 1;
  return forms[Math.min(index, forms.length - 1)]!;
}

// «1–7 нояб.», «1 сент. – 8 нояб.», «1 дек. 2025 – 8 янв. 2026» (the year when it isn't `today`'s).
export function formatRange(from: string, to: string, today: string, locale = currentLocale()) {
  const year = today.slice(0, 4);
  const format = new Intl.DateTimeFormat(intlLocale(locale), {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
    ...(from.slice(0, 4) !== year || to.slice(0, 4) !== year ? { year: "numeric" } : {}),
  });
  return format.formatRange(fromDateString(from), fromDateString(to)).replace(/ г\./g, "");
}
