import { describe, expect, it } from "vitest";

import { continueList, toggleLines, wrapSelection } from "./note-edit";
import { checkProgress, parseInline, parseNote, toggleCheck } from "./note-format";

describe("notes formatting", () => {
  it("reads headings, lists, checklists, quotes and paragraphs", () => {
    const text = [
      "# План",
      "Первый абзац",
      "вторая строка",
      "",
      "- пункт",
      "- ещё пункт",
      "1. один",
      "2. два",
      "- [ ] позвонить",
      "- [x] написать",
      "> цитата",
    ].join("\n");
    expect(parseNote(text).map((b) => b.type)).toEqual([
      "heading",
      "paragraph",
      "bullets",
      "numbers",
      "checks",
      "quote",
    ]);
    const blocks = parseNote(text);
    expect(blocks[1]).toMatchObject({ type: "paragraph", lines: [[{}], [{}]] });
    expect(blocks[4]).toMatchObject({
      type: "checks",
      items: [
        { done: false, line: 8 },
        { done: true, line: 9 },
      ],
    });
  });

  it("reads bold, italic, code and links, not marks inside words", () => {
    expect(parseInline("**важно** и *курсив* и `код`")).toEqual([
      { type: "bold", children: [{ type: "text", text: "важно" }] },
      { type: "text", text: " и " },
      { type: "italic", children: [{ type: "text", text: "курсив" }] },
      { type: "text", text: " и " },
      { type: "code", text: "код" },
    ]);
    expect(parseInline("см. https://example.com/a?b=1.")).toEqual([
      { type: "text", text: "см. " },
      { type: "link", href: "https://example.com/a?b=1", text: "https://example.com/a?b=1" },
      { type: "text", text: "." },
    ]);
    expect(parseInline("file_name_here 2*3*4")).toEqual([
      { type: "text", text: "file_name_here 2*3*4" },
    ]);
    // Markup is text, never HTML.
    expect(parseInline("<script>alert(1)</script>")).toEqual([
      { type: "text", text: "<script>alert(1)</script>" },
    ]);
  });

  it("ticks a checklist item by its line and counts them", () => {
    const text = "- [ ] один\n- [x] два\nтекст";
    expect(toggleCheck(text, 0)).toBe("- [x] один\n- [x] два\nтекст");
    expect(toggleCheck(text, 1)).toBe("- [ ] один\n- [ ] два\nтекст");
    expect(toggleCheck(text, 2)).toBe(text);
    expect(checkProgress(text)).toEqual({ done: 1, total: 2 });
  });
});

describe("editing the notes' text", () => {
  it("wraps the selection in bold or italic and takes it off again", () => {
    const on = wrapSelection({ text: "сделать отчёт", start: 8, end: 13 }, "**");
    expect(on).toEqual({ text: "сделать **отчёт**", start: 10, end: 15 });
    expect(wrapSelection(on, "**")).toEqual({ text: "сделать отчёт", start: 8, end: 13 });
    expect(wrapSelection({ text: "a", start: 1, end: 1 }, "*")).toEqual({
      text: "a**",
      start: 2,
      end: 2,
    });
  });

  it("makes lines list items, checklist items or headings, and back", () => {
    const text = "молоко\nхлеб";
    const checks = toggleLines({ text, start: 0, end: text.length }, "check");
    expect(checks.text).toBe("- [ ] молоко\n- [ ] хлеб");
    expect(toggleLines({ ...checks, start: 0, end: checks.text.length }, "check").text).toBe(text);
    expect(toggleLines({ text, start: 0, end: text.length }, "number").text).toBe(
      "1. молоко\n2. хлеб",
    );
    // An empty line gets the mark, ready to type.
    expect(toggleLines({ text: "a\n", start: 2, end: 2 }, "check")).toEqual({
      text: "a\n- [ ] ",
      start: 8,
      end: 8,
    });
    // A bullet becomes a heading, not both.
    expect(toggleLines({ text: "- итог", start: 2, end: 2 }, "heading").text).toBe("## итог");
  });

  it("continues a list on Enter and ends it on an empty item", () => {
    const text = "- [x] первое";
    expect(continueList({ text, start: text.length, end: text.length })).toEqual({
      text: "- [x] первое\n- [ ] ",
      start: text.length + 7,
      end: text.length + 7,
    });
    expect(continueList({ text: "3. три", start: 6, end: 6 })?.text).toBe("3. три\n4. ");
    expect(continueList({ text: "a\n- ", start: 4, end: 4 })).toEqual({
      text: "a\n",
      start: 2,
      end: 2,
    });
    expect(continueList({ text: "просто текст", start: 5, end: 5 })).toBeNull();
  });
});
