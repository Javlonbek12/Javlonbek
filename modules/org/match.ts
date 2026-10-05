import { displayName } from "@/modules/core/users/display-name";

// Uzbek/Russian Cyrillic to Latin, so "Жавлонбек" and "Javlonbek" are the same name.
const CYRILLIC: Record<string, string> = {
  а: "a",
  б: "b",
  в: "v",
  г: "g",
  д: "d",
  е: "e",
  ё: "yo",
  ж: "j",
  з: "z",
  и: "i",
  й: "y",
  к: "k",
  л: "l",
  м: "m",
  н: "n",
  о: "o",
  п: "p",
  р: "r",
  с: "s",
  т: "t",
  у: "u",
  ф: "f",
  х: "x",
  ц: "ts",
  ч: "ch",
  ш: "sh",
  щ: "sh",
  ъ: "",
  ы: "i",
  ь: "",
  э: "e",
  ю: "yu",
  я: "ya",
  ў: "o",
  қ: "q",
  ғ: "g",
  ҳ: "h",
};

export const normName = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[\u0400-\u04ff]/g, (c) => CYRILLIC[c] ?? c)
    .replace(/['’ʻʼ`]/g, "")
    .replace(/\s+/g, " ");
const norm = normName;

// The app user a written name refers to: full name or first name, only if exactly one matches.
export function matchUser(
  name: string,
  users: { id: string; firstName: string; lastName: string | null }[],
) {
  const target = norm(name);
  const candidates = users.filter(
    (u) => norm(displayName(u)) === target || norm(u.firstName) === target,
  );
  return candidates.length === 1 ? candidates[0].id : null;
}
