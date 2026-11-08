import { toDateString } from "@/lib/dates";
import { dateFormat, type Locale } from "@/lib/i18n";

// Where a price list stands today. «current» is the list in force (currentPriceList); a later
// list is «future» until its date, or «waiting» when its date has come but nobody applied it yet
// (planograms still carry the older prices); an earlier one is «past».
export type PriceListStatus = "current" | "future" | "waiting" | "past";

type Ordered = { id: string; effectiveFrom: Date; createdAt: Date };

// Lists replace each other in this order: by «Действует с», then by when they were made.
export function isLaterList(a: Ordered, b: Ordered): boolean {
  const byDate = a.effectiveFrom.getTime() - b.effectiveFrom.getTime();
  return byDate !== 0 ? byDate > 0 : a.createdAt.getTime() > b.createdAt.getTime();
}

export function priceListStatus(
  list: Ordered & { appliedAt: Date | null },
  current: Ordered | null,
  today: string,
): PriceListStatus {
  if (current && list.id === current.id) return "current";
  if (current && !isLaterList(list, current)) return "past";
  if (toDateString(list.effectiveFrom) > today) return "future";
  return list.appliedAt ? "past" : "waiting";
}

// A price list's date always with its year: «1 янв. 2027». Price lists are documents that live
// across years, and a date without one reads as this year.
export function priceListDate(date: Date, locale?: Locale): string {
  return dateFormat({ day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }, locale)
    .format(date)
    .replace(/\s?г\.$/, "");
}
