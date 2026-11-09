import { fromDateString } from "@/lib/dates";
import { formatNumber } from "@/lib/format";
import {
  currentExportLocale,
  intlLocale,
  t,
  type ExportLocale,
  type TranslationKey,
} from "@/lib/i18n";

// Numbers and periods in words for reports, Connect and the content plan: a decimal comma in
// Russian, plurals that agree («1 пост», «3 поста», «5 постов») and date ranges with the year
// only when it isn't this one. Numbers go through lib/format; the word-only plural forms here
// («пост|поста|постов», without «{n}») suit phrases where the number stands apart from the word.

// A number with up to `digits` decimals: «7,3» in Russian, «7.3» in English.
export const formatDecimal = (
  value: number,
  digits = 1,
  locale: ExportLocale = currentExportLocale(),
) => formatNumber(value, digits, locale);

// The number and the word that agrees with it: «1 пост», «3 поста», «5 постов», «1,5 дня».
// The dictionary keeps the word's forms separated by «|»: Russian «one|few|many»
// («пост|поста|постов»), English «one|other» («post|posts»). Korean (only in downloads) has one
// form that starts with a counter written next to the number («3건의 지급 요청»).
export function plural(
  key: TranslationKey,
  count: number,
  locale: ExportLocale = currentExportLocale(),
) {
  const gap = locale === "ko" ? "" : " ";
  return `${formatDecimal(count, 1, locale)}${gap}${pluralWord(key, count, locale)}`;
}

// Only the word, for phrases where the number stands elsewhere.
export function pluralWord(
  key: TranslationKey,
  count: number,
  locale: ExportLocale = currentExportLocale(),
) {
  const forms = t(key, undefined, locale).split("|");
  const rule = new Intl.PluralRules(intlLocale(locale)).select(count);
  // Russian fractions («1,5 дня») take the «few» form, like English «other» takes the second.
  const index = rule === "one" ? 0 : rule === "many" && forms.length > 2 ? 2 : 1;
  return forms[Math.min(index, forms.length - 1)]!;
}

// «1–7 нояб.», «1 сент. – 8 нояб.», «1 дек. 2025 – 8 янв. 2026» (the year when it isn't `today`'s).
export function formatRange(
  from: string,
  to: string,
  today: string,
  locale: ExportLocale = currentExportLocale(),
) {
  const year = today.slice(0, 4);
  const format = new Intl.DateTimeFormat(intlLocale(locale), {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
    ...(from.slice(0, 4) !== year || to.slice(0, 4) !== year ? { year: "numeric" } : {}),
  });
  return format.formatRange(fromDateString(from), fromDateString(to)).replace(/ г\./g, "");
}
