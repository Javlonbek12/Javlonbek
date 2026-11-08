import { displayName } from "@/modules/core/users/display-name";

type Named = { id: string; firstName: string; lastName?: string | null; position?: string | null };

// Names for a list of people where two may share one (two «Тест» in a team): a name met more than
// once gets the person's position after it («Тест · Мерчендайзер»), so the rows can be told apart.
// Everyone else keeps the plain name.
export function distinctNames(people: Named[]): Map<string, string> {
  const unique = new Map(people.map((person) => [person.id, person]));
  const seen = new Map<string, number>();
  for (const person of unique.values()) {
    const name = displayName(person);
    seen.set(name, (seen.get(name) ?? 0) + 1);
  }
  const result = new Map<string, string>();
  for (const person of unique.values()) {
    const name = displayName(person);
    const position = person.position?.trim();
    result.set(person.id, (seen.get(name) ?? 0) > 1 && position ? `${name} · ${position}` : name);
  }
  return result;
}
