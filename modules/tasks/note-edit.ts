// Editing the notes' text in a plain text field: the toolbar's buttons and the Enter key work on
// the text and the selection and give back the new text and selection. No DOM here, so it is
// tested on its own.

export type Edit = { text: string; start: number; end: number };

// **bold** / *italic* around the selection (or an empty pair at the cursor); again — off.
export function wrapSelection(edit: Edit, mark: "**" | "*"): Edit {
  const { text, start, end } = edit;
  const before = text.slice(start - mark.length, start);
  const after = text.slice(end, end + mark.length);
  // Inside **bold**, a single * is not italic around the selection.
  const insideBold = mark === "*" && (text[start - 2] === "*" || text[end + 1] === "*");
  if (before === mark && after === mark && !insideBold)
    return {
      text:
        text.slice(0, start - mark.length) + text.slice(start, end) + text.slice(end + mark.length),
      start: start - mark.length,
      end: end - mark.length,
    };
  return {
    text: text.slice(0, start) + mark + text.slice(start, end) + mark + text.slice(end),
    start: start + mark.length,
    end: end + mark.length,
  };
}

export type LineKind = "heading" | "bullet" | "number" | "check";

const PREFIX: Record<LineKind, RegExp> = {
  heading: /^#{1,2}\s+/,
  bullet: /^\s*[-*•]\s+(?!\[[ xX]\])/,
  number: /^\s*\d{1,4}[.)]\s+/,
  check: /^\s*[-*]\s+\[[ xX]\]\s?/,
};
// Any of them, to replace one kind with another.
const ANY = /^(#{1,2}\s+|\s*[-*]\s+\[[ xX]\]\s?|\s*[-*•]\s+|\s*\d{1,4}[.)]\s+)/;

// Makes the selected lines headings / list items / checklist items; if they all are already, the
// mark comes off.
export function toggleLines(edit: Edit, kind: LineKind): Edit {
  const { text, start, end } = edit;
  const from = text.lastIndexOf("\n", start - 1) + 1;
  const toBreak = text.indexOf("\n", end > start && text[end - 1] === "\n" ? end - 1 : end);
  const to = toBreak < 0 ? text.length : toBreak;
  const lines = text.slice(from, to).split("\n");
  // Off only when every written line already has this mark (an empty line gets it on).
  const written = lines.filter((l) => l.trim() !== "");
  const all = written.length > 0 && written.every((l) => PREFIX[kind].test(l));
  let n = 0;
  const changed = lines.map((l) => {
    if (l.trim() === "" && lines.length > 1) return l;
    const bare = l.replace(ANY, "");
    if (all) return bare;
    n += 1;
    const mark =
      kind === "heading"
        ? "## "
        : kind === "bullet"
          ? "- "
          : kind === "number"
            ? `${n}. `
            : "- [ ] ";
    return mark + bare;
  });
  const middle = changed.join("\n");
  return {
    text: text.slice(0, from) + middle + text.slice(to),
    start: lines.length === 1 ? from + middle.length : from,
    end: from + middle.length,
  };
}

// Enter inside a list: the next line gets the same mark (the next number, an open checkbox);
// Enter on an empty item ends the list. Null: an ordinary Enter.
export function continueList(edit: Edit): Edit | null {
  const { text, start, end } = edit;
  if (start !== end) return null;
  const from = text.lastIndexOf("\n", start - 1) + 1;
  const line = text.slice(from, start);
  const match = /^(\s*)([-*]\s+\[[ xX]\]\s?|[-*•]\s+|(\d{1,4})([.)])\s+)(.*)$/.exec(line);
  if (!match) return null;
  const [, indent, mark, number, dot, rest] = match;
  if (rest!.trim() === "" && text.slice(start).split("\n")[0]!.trim() === "") {
    // An empty item: the mark goes, the list ends.
    return { text: text.slice(0, from) + text.slice(start), start: from, end: from };
  }
  const next = number
    ? `${Number(number) + 1}${dot} `
    : /\[[ xX]\]/.test(mark!)
      ? "- [ ] "
      : `${mark!.trim()} `;
  const insert = `\n${indent}${next}`;
  return {
    text: text.slice(0, start) + insert + text.slice(end),
    start: start + insert.length,
    end: start + insert.length,
  };
}
