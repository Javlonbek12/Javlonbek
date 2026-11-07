// Light formatting of a task's notes, kept in the text itself so it reads fine as plain text
// (in the bot, in a copy) and needs no HTML: the view draws these blocks as elements, never
// as markup, so nothing in a note can run in the page.
//
//   # Заголовок        ## Подзаголовок
//   **жирный**  *курсив*  `код`  https://ссылка
//   - пункт списка     1. пункт по номерам
//   - [ ] дело         - [x] сделано
//   > цитата

export type Inline =
  | { type: "text"; text: string }
  | { type: "bold"; children: Inline[] }
  | { type: "italic"; children: Inline[] }
  | { type: "code"; text: string }
  | { type: "link"; href: string; text: string };

export type NoteItem = { content: Inline[]; line: number };

export type Block =
  | { type: "heading"; level: 1 | 2; content: Inline[]; line: number }
  | { type: "paragraph"; lines: Inline[][]; line: number }
  | { type: "quote"; lines: Inline[][]; line: number }
  | { type: "bullets"; items: NoteItem[] }
  | { type: "numbers"; start: number; items: NoteItem[] }
  | { type: "checks"; items: (NoteItem & { done: boolean })[] };

const HEADING = /^(#{1,2})\s+(.*)$/;
const CHECK = /^\s*[-*]\s+\[( |x|X)\]\s?(.*)$/;
const BULLET = /^\s*[-*•]\s+(.*)$/;
const NUMBER = /^\s*(\d{1,4})[.)]\s+(.*)$/;
const QUOTE = /^>\s?(.*)$/;

// Inline marks, earliest first: `code`, **bold**, *italic* / _italic_ (not inside words), links.
const INLINE =
  /`([^`\n]+)`|\*\*([^*\n]+?)\*\*|(?<![\p{L}\p{N}*])\*([^*\s][^*\n]*?)\*(?![\p{L}\p{N}*])|(?<![\p{L}\p{N}_])_([^_\s][^_\n]*?)_(?![\p{L}\p{N}_])|(https?:\/\/[^\s<>()"']+)/gu;

export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  for (const match of text.matchAll(INLINE)) {
    const at = match.index!;
    if (at > last) out.push({ type: "text", text: text.slice(last, at) });
    const [whole, code, bold, star, underscore, url] = match;
    if (code !== undefined) out.push({ type: "code", text: code });
    else if (bold !== undefined) out.push({ type: "bold", children: parseInline(bold) });
    else if (star !== undefined || underscore !== undefined)
      out.push({ type: "italic", children: parseInline((star ?? underscore)!) });
    else if (url !== undefined) {
      // A link doesn't take the sentence's last mark with it ("см. https://x.uz.").
      const href = url.replace(/[.,;:!?]+$/, "");
      out.push({ type: "link", href, text: href });
      if (href.length < url.length) out.push({ type: "text", text: url.slice(href.length) });
    }
    last = at + whole.length;
  }
  if (last < text.length) out.push({ type: "text", text: text.slice(last) });
  return out;
}

export function parseNote(text: string): Block[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  const lastBlock = () => blocks[blocks.length - 1];
  lines.forEach((raw, line) => {
    if (raw.trim() === "") {
      blocks.push({ type: "paragraph", lines: [], line }); // a break between paragraphs
      return;
    }
    const heading = HEADING.exec(raw);
    if (heading) {
      blocks.push({
        type: "heading",
        level: heading[1]!.length as 1 | 2,
        content: parseInline(heading[2]!),
        line,
      });
      return;
    }
    const check = CHECK.exec(raw);
    if (check) {
      const item = { content: parseInline(check[2]!), line, done: check[1] !== " " };
      const prev = lastBlock();
      if (prev?.type === "checks") prev.items.push(item);
      else blocks.push({ type: "checks", items: [item] });
      return;
    }
    const bullet = BULLET.exec(raw);
    if (bullet) {
      const item = { content: parseInline(bullet[1]!), line };
      const prev = lastBlock();
      if (prev?.type === "bullets") prev.items.push(item);
      else blocks.push({ type: "bullets", items: [item] });
      return;
    }
    const number = NUMBER.exec(raw);
    if (number) {
      const item = { content: parseInline(number[2]!), line };
      const prev = lastBlock();
      if (prev?.type === "numbers") prev.items.push(item);
      else blocks.push({ type: "numbers", start: Number(number[1]), items: [item] });
      return;
    }
    const quote = QUOTE.exec(raw);
    if (quote) {
      const prev = lastBlock();
      if (prev?.type === "quote") prev.lines.push(parseInline(quote[1]!));
      else blocks.push({ type: "quote", lines: [parseInline(quote[1]!)], line });
      return;
    }
    const prev = lastBlock();
    if (prev?.type === "paragraph" && prev.lines.length > 0) prev.lines.push(parseInline(raw));
    else blocks.push({ type: "paragraph", lines: [parseInline(raw)], line });
  });
  // Breaks only matter between paragraphs: drop the empty markers.
  return blocks.filter((b) => b.type !== "paragraph" || b.lines.length > 0);
}

// Ticks or unticks the checklist item on `line` (the view's checkboxes).
export function toggleCheck(text: string, line: number): string {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const current = lines[line];
  if (current === undefined || !CHECK.test(current)) return text;
  lines[line] = current.replace(/\[( |x|X)\]/, (mark) => (mark === "[ ]" ? "[x]" : "[ ]"));
  return lines.join("\n");
}

// How many checklist items are done (for a short summary next to the tab).
export function checkProgress(text: string) {
  const items = parseNote(text).flatMap((b) => (b.type === "checks" ? b.items : []));
  return { done: items.filter((i) => i.done).length, total: items.length };
}
