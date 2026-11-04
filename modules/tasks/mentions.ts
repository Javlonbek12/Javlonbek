// @mentions in task comments (routing v2, «Уведомления»): «@ivan_k» (the Telegram username),
// «@Иван» (a first name only one person has) or «@Иван Петров» (first and last name).

type Person = {
  id: string;
  firstName: string;
  lastName: string | null;
  telegramUsername: string | null;
};

const same = (a: string, b: string | null) => b !== null && a.toLowerCase() === b.toLowerCase();

export function mentionedUserIds(text: string, people: Person[]): string[] {
  const found = new Set<string>();
  for (const match of text.matchAll(
    /(?:^|[^\p{L}\p{N}_])@([\p{L}\p{N}_.-]+)(?:\s+([\p{L}-]+))?/gu,
  )) {
    const word = match[1]!.replace(/[.-]+$/, "");
    const next = match[2] ?? null;
    const byUsername = people.find((p) =>
      same(word, p.telegramUsername?.replace(/^@/, "") ?? null),
    );
    if (byUsername) {
      found.add(byUsername.id);
      continue;
    }
    const byName = people.filter((p) => same(word, p.firstName));
    const full = next ? byName.filter((p) => same(next, p.lastName)) : [];
    if (full.length === 1) found.add(full[0]!.id);
    else if (byName.length === 1) found.add(byName[0]!.id);
  }
  return [...found];
}
