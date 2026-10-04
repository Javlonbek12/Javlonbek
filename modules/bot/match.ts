// Matching a name the user said ("Азизу", "Aziz", "Дильноза") with team members.

type Person = {
  id: string;
  firstName: string;
  lastName: string | null;
  telegramUsername: string | null;
};

export type MatchResult<T> =
  { status: "matched"; user: T } | { status: "ambiguous"; candidates: T[] } | { status: "none" };

const CYR_TO_LAT: Record<string, string> = {
  а: "a",
  б: "b",
  в: "v",
  г: "g",
  ғ: "g",
  д: "d",
  е: "e",
  ё: "yo",
  ж: "j",
  з: "z",
  и: "i",
  й: "y",
  к: "k",
  қ: "q",
  л: "l",
  м: "m",
  н: "n",
  о: "o",
  п: "p",
  р: "r",
  с: "s",
  т: "t",
  у: "u",
  ў: "o",
  ф: "f",
  х: "x",
  ҳ: "h",
  ц: "s",
  ч: "ch",
  ш: "sh",
  щ: "sh",
  ъ: "",
  ы: "i",
  ь: "",
  э: "e",
  ю: "yu",
  я: "ya",
};

// Lowercase Latin form, so "Азиз" and "Aziz" compare equal.
export function normalizeName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[ʻʼ'`’]/g, "")
    .split("")
    .map((ch) => CYR_TO_LAT[ch] ?? ch)
    .join("")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/kh/g, "x")
    .trim();
}

// Drops common Russian case endings and Uzbek suffixes: "азизу" → "aziz", "azizga" → "aziz".
function stem(word: string): string {
  return word.replace(
    /(ning|ga|ka|qa|ni|dan|da|ovna|evna|ovich|evich|oy|ey|om|em|oyu|eyu|u|e|yu|i|y|a|ya)$/,
    "",
  );
}

function levenshtein(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const temp = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = temp;
    }
  }
  return row[b.length];
}

function wordScore(said: string, known: string): number {
  if (!said || !known) return 0;
  if (said === known) return 1;
  const s = stem(said);
  const k = stem(known);
  if (s.length >= 3 && s === k) return 0.95;
  if (s.length >= 3 && (known.startsWith(s) || said.startsWith(k)) && k.length >= 3) return 0.9;
  if (Math.min(s.length, k.length) >= 4 && levenshtein(s, k) <= 1) return 0.8;
  return 0;
}

export function nameScore(said: string, person: Person): number {
  const saidWords = normalizeName(said).split(/\s+/).filter(Boolean);
  const knownWords = [person.firstName, person.lastName ?? "", person.telegramUsername ?? ""]
    .map(normalizeName)
    .flatMap((w) => w.split(/\s+/))
    .filter(Boolean);
  if (saidWords.length === 0) return 0;
  // Every word the user said must match some part of the person's name.
  const scores = saidWords.map((w) => Math.max(0, ...knownWords.map((k) => wordScore(w, k))));
  return Math.min(...scores);
}

export function matchPerson<T extends Person>(said: string, people: T[]): MatchResult<T> {
  const scored = people
    .map((user) => ({ user, score: nameScore(said, user) }))
    .filter((x) => x.score >= 0.8)
    .sort((a, b) => b.score - a.score);
  if (scored.length === 0) return { status: "none" };
  const best = scored.filter((x) => x.score === scored[0].score);
  if (best.length === 1) return { status: "matched", user: best[0].user };
  return { status: "ambiguous", candidates: best.map((x) => x.user) };
}
