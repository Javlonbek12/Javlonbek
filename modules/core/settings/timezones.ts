import { t, type Locale, type TranslationKey } from "@/lib/i18n";

// The zones the team is most likely to need, with city names from the dictionary; they come first.
const COMMON: { zone: string; city: TranslationKey }[] = [
  { zone: "Asia/Tashkent", city: "settings.zones.tashkent" },
  { zone: "Asia/Samarkand", city: "settings.zones.samarkand" },
  { zone: "Asia/Almaty", city: "settings.zones.almaty" },
  { zone: "Asia/Bishkek", city: "settings.zones.bishkek" },
  { zone: "Asia/Dushanbe", city: "settings.zones.dushanbe" },
  { zone: "Asia/Dubai", city: "settings.zones.dubai" },
  { zone: "Europe/Moscow", city: "settings.zones.moscow" },
  { zone: "Europe/Istanbul", city: "settings.zones.istanbul" },
  { zone: "Asia/Seoul", city: "settings.zones.seoul" },
  { zone: "Europe/London", city: "settings.zones.london" },
];

export type TimezoneOption = { value: string; label: string };

// "UTC+5" for the zone at this moment (summer time included).
export function utcOffset(zone: string, now = new Date()): string {
  const part = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "shortOffset" })
    .formatToParts(now)
    .find((p) => p.type === "timeZoneName")?.value;
  return !part || part === "GMT" || part === "GMT+0" ? "UTC" : part.replace("GMT", "UTC");
}

// "America/Argentina/Buenos_Aires" → "Buenos Aires (America)".
function readable(zone: string): string {
  const parts = zone.split("/");
  const city = parts.at(-1)!.replaceAll("_", " ");
  return parts.length > 1 ? `${city} (${parts[0]})` : city;
}

// A select instead of free text: common cities first, then every IANA zone by its city name.
// `current` is kept even if this runtime doesn't list it.
export function timezoneOptions(locale: Locale, current: string, now = new Date()) {
  const label = (name: string, zone: string) => `${name} — ${utcOffset(zone, now)}`;
  const common = COMMON.map(({ zone, city }) => ({
    value: zone,
    label: label(t(city, undefined, locale), zone),
  }));
  const taken = new Set(common.map((o) => o.value));
  const zones = [...Intl.supportedValuesOf("timeZone"), "UTC"];
  if (!zones.includes(current)) zones.push(current);
  const all = [...new Set(zones)]
    .filter((zone) => !taken.has(zone))
    .map((zone) => ({ value: zone, label: label(readable(zone), zone) }))
    .sort((a, b) => a.label.localeCompare(b.label));
  return { common, all };
}
