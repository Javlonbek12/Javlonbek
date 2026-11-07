"use client";

import {
  Bold,
  Heading2,
  Italic,
  List,
  ListChecks,
  ListOrdered,
  type LucideIcon,
} from "lucide-react";
import {
  Fragment,
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";

import { saveTaskNoteAction } from "@/app/(app)/tasks/actions";
import { useLocale, useT } from "@/components/locale-provider";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  continueList,
  toggleLines,
  wrapSelection,
  type Edit,
  type LineKind,
} from "@/modules/tasks/note-edit";
import { parseNote, toggleCheck, type Inline } from "@/modules/tasks/note-format";
import type { NoteView } from "@/modules/tasks/notes";

// The «Заметки» tab: the shared notes of a task. Shown formatted; a click (or «Изменить») opens a
// plain text field with a formatting toolbar. Saved on its own a moment after typing stops, on
// leaving the field and on «Готово»; a checklist item is ticked right in the view.

const SAVE_AFTER_MS = 1200;

type ToolId = "heading" | "bold" | "italic" | "bullet" | "number" | "check";
const TOOLS: { id: ToolId; icon: LucideIcon }[] = [
  { id: "heading", icon: Heading2 },
  { id: "bold", icon: Bold },
  { id: "italic", icon: Italic },
  { id: "bullet", icon: List },
  { id: "number", icon: ListOrdered },
  { id: "check", icon: ListChecks },
];

function runTool(id: ToolId, edit: Edit): Edit {
  if (id === "bold") return wrapSelection(edit, "**");
  if (id === "italic") return wrapSelection(edit, "*");
  return toggleLines(edit, id satisfies LineKind);
}

type Status = "idle" | "dirty" | "saving" | "saved" | "failed";

function InlineView({ parts }: { parts: Inline[] }): ReactNode {
  return parts.map((part, i) => {
    if (part.type === "text") return <Fragment key={i}>{part.text}</Fragment>;
    if (part.type === "bold")
      return (
        <strong key={i} className="font-semibold">
          <InlineView parts={part.children} />
        </strong>
      );
    if (part.type === "italic")
      return (
        <em key={i}>
          <InlineView parts={part.children} />
        </em>
      );
    if (part.type === "code")
      return (
        <code key={i} className="bg-muted rounded px-1 font-mono text-[0.85em]">
          {part.text}
        </code>
      );
    return (
      <a
        key={i}
        href={part.href}
        target="_blank"
        rel="noopener noreferrer"
        className="text-primary break-all underline"
        onClick={(e) => e.stopPropagation()}
      >
        {part.text}
      </a>
    );
  });
}

function NoteBody({
  text,
  onToggle,
}: {
  text: string;
  // Ticking a checklist item (null: read-only).
  onToggle: ((line: number) => void) | null;
}) {
  return (
    <div className="flex flex-col gap-2 text-sm leading-relaxed break-words">
      {parseNote(text).map((block, i) => {
        if (block.type === "heading")
          return block.level === 1 ? (
            <h3 key={i} className="text-base font-semibold">
              <InlineView parts={block.content} />
            </h3>
          ) : (
            <h4 key={i} className="font-semibold">
              <InlineView parts={block.content} />
            </h4>
          );
        if (block.type === "paragraph")
          return (
            <p key={i}>
              {block.lines.map((line, j) => (
                <Fragment key={j}>
                  {j > 0 && <br />}
                  <InlineView parts={line} />
                </Fragment>
              ))}
            </p>
          );
        if (block.type === "quote")
          return (
            <blockquote key={i} className="text-muted-foreground border-l-2 pl-3">
              {block.lines.map((line, j) => (
                <Fragment key={j}>
                  {j > 0 && <br />}
                  <InlineView parts={line} />
                </Fragment>
              ))}
            </blockquote>
          );
        if (block.type === "bullets")
          return (
            <ul key={i} className="list-disc pl-5">
              {block.items.map((item) => (
                <li key={item.line}>
                  <InlineView parts={item.content} />
                </li>
              ))}
            </ul>
          );
        if (block.type === "numbers")
          return (
            <ol key={i} start={block.start} className="list-decimal pl-5">
              {block.items.map((item) => (
                <li key={item.line}>
                  <InlineView parts={item.content} />
                </li>
              ))}
            </ol>
          );
        return (
          <ul key={i} className="flex flex-col gap-1">
            {block.items.map((item) => (
              <li key={item.line} className="flex items-start gap-2">
                <input
                  type="checkbox"
                  checked={item.done}
                  disabled={!onToggle}
                  onChange={() => onToggle?.(item.line)}
                  onClick={(e) => e.stopPropagation()}
                  className="accent-primary mt-1 size-4 shrink-0"
                  aria-label={item.content.map((p) => ("text" in p ? p.text : "")).join("")}
                />
                <span className={cn(item.done && "text-muted-foreground line-through")}>
                  <InlineView parts={item.content} />
                </span>
              </li>
            ))}
          </ul>
        );
      })}
    </div>
  );
}

export function TaskNotes({
  taskId,
  initial,
  canEdit,
}: {
  taskId: string;
  initial: NoteView;
  canEdit: boolean;
}) {
  const t = useT();
  const locale = useLocale();
  const [text, setText] = useState(initial.text);
  const [editing, setEditing] = useState(false);
  const [status, setStatus] = useState<Status>("idle");
  const [meta, setMeta] = useState({ updatedAt: initial.updatedAt, by: initial.updatedBy });
  const [conflict, setConflict] = useState<NoteView | null>(null);
  // What the server has: the version saves are made on, and its text (to know what is unsaved).
  const saved = useRef({ version: initial.version, text: initial.text });
  const latest = useRef(text);
  const busy = useRef(false);
  const field = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    latest.current = text;
  }, [text]);

  const save = useCallback(
    async (value: string, base = saved.current.version) => {
      if (busy.current) return;
      if (value === saved.current.text && base === saved.current.version) {
        setStatus((s) => (s === "dirty" ? "saved" : s));
        return;
      }
      busy.current = true;
      setStatus("saving");
      try {
        const result = await saveTaskNoteAction(taskId, value, base);
        if (result.ok) {
          saved.current = { version: result.version, text: value };
          setMeta({ updatedAt: result.updatedAt, by: null });
          setConflict(null);
          setStatus(latest.current === value ? "saved" : "dirty");
        } else if ("conflict" in result) {
          setConflict(result.conflict);
          setStatus("dirty");
        } else setStatus("failed");
      } catch {
        setStatus("failed");
      } finally {
        busy.current = false;
      }
    },
    [taskId],
  );

  // Autosave: a moment after the last change (and again after a failed try).
  useEffect(() => {
    if (conflict || text === saved.current.text) return;
    const timer = setTimeout(
      () => void save(latest.current),
      status === "failed" ? 5000 : SAVE_AFTER_MS,
    );
    return () => clearTimeout(timer);
  }, [text, status, conflict, save]);

  // Leaving the page with unsaved text: the browser asks.
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (latest.current !== saved.current.text) e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);

  const change = (next: string) => {
    latest.current = next;
    setText(next);
    setStatus("dirty");
  };

  const applyEdit = (fn: (e: Edit) => Edit | null) => {
    const el = field.current;
    if (!el) return false;
    const next = fn({ text: el.value, start: el.selectionStart, end: el.selectionEnd });
    if (!next) return false;
    change(next.text);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(next.start, next.end);
    });
    return true;
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && (e.key === "b" || e.key === "и")) {
      e.preventDefault();
      applyEdit((s) => wrapSelection(s, "**"));
    } else if ((e.ctrlKey || e.metaKey) && (e.key === "i" || e.key === "ш")) {
      e.preventDefault();
      applyEdit((s) => wrapSelection(s, "*"));
    } else if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      if (applyEdit(continueList)) e.preventDefault();
    }
  };

  const when = meta.updatedAt
    ? new Intl.DateTimeFormat(locale === "en" ? "en-GB" : "ru-RU", {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(meta.updatedAt))
    : null;
  const statusText =
    status === "saving"
      ? t("tasks.notes.saving")
      : status === "dirty"
        ? t("tasks.notes.unsaved")
        : status === "failed"
          ? t("tasks.notes.failed")
          : status === "saved"
            ? t("tasks.notes.saved")
            : meta.by && when
              ? t("tasks.notes.lastBy", { name: meta.by, when })
              : null;

  const finish = () => {
    setEditing(false);
    void save(latest.current);
  };

  return (
    <div className="flex flex-col gap-3">
      {conflict && (
        <div
          role="alert"
          className="flex flex-col gap-2 rounded-lg bg-amber-500/10 p-3 text-sm text-amber-900 dark:text-amber-100"
        >
          <span>{t("tasks.notes.conflict", { name: conflict.updatedBy ?? "—" })}</span>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                saved.current = { version: conflict.version, text: conflict.text };
                setText(conflict.text);
                setMeta({ updatedAt: conflict.updatedAt, by: conflict.updatedBy });
                setConflict(null);
                setStatus("idle");
              }}
            >
              {t("tasks.notes.takeTheirs")}
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => {
                const base = conflict.version;
                setConflict(null);
                saved.current = { version: base, text: conflict.text };
                void save(latest.current, base);
              }}
            >
              {t("tasks.notes.keepMine")}
            </Button>
          </div>
        </div>
      )}

      {editing ? (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-1" role="toolbar">
            {TOOLS.map((tool) => (
              <Button
                key={tool.id}
                type="button"
                size="icon"
                variant="ghost"
                className="size-8"
                title={t(`tasks.notes.tool.${tool.id}`)}
                aria-label={t(`tasks.notes.tool.${tool.id}`)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => applyEdit((edit) => runTool(tool.id, edit))}
              >
                <tool.icon className="size-4" />
              </Button>
            ))}
            <Button type="button" size="sm" className="ml-auto" onClick={finish}>
              {t("tasks.notes.done")}
            </Button>
          </div>
          <textarea
            ref={field}
            value={text}
            onChange={(e) => change(e.target.value)}
            onKeyDown={onKeyDown}
            onBlur={() => void save(latest.current)}
            placeholder={t("tasks.notes.placeholder")}
            aria-label={t("tasks.panel.tabs.notes")}
            autoFocus
            rows={Math.min(24, Math.max(8, text.split("\n").length + 2))}
            className="border-input bg-background focus-visible:ring-ring w-full resize-y rounded-lg border p-3 font-mono text-sm leading-relaxed focus-visible:ring-2 focus-visible:outline-none"
          />
        </div>
      ) : text.trim() ? (
        <div
          role={canEdit ? "button" : undefined}
          tabIndex={canEdit ? 0 : undefined}
          onClick={() => canEdit && setEditing(true)}
          onKeyDown={(e) => {
            if (canEdit && (e.key === "Enter" || e.key === " ") && e.target === e.currentTarget) {
              e.preventDefault();
              setEditing(true);
            }
          }}
          className={cn(
            "rounded-lg p-1",
            canEdit && "hover:bg-muted/50 focus-visible:ring-ring cursor-text focus-visible:ring-2",
          )}
        >
          <NoteBody
            text={text}
            onToggle={
              canEdit
                ? (line) => {
                    const next = toggleCheck(latest.current, line);
                    setText(next);
                    void save(next);
                  }
                : null
            }
          />
        </div>
      ) : canEdit ? (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="text-muted-foreground hover:bg-muted/50 rounded-lg border border-dashed p-4 text-left text-sm"
        >
          {t("tasks.notes.emptyEdit")}
        </button>
      ) : (
        <p className="text-muted-foreground text-sm">{t("tasks.notes.empty")}</p>
      )}

      <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        {statusText && (
          <span role="status" className={cn(status === "failed" && "text-destructive font-medium")}>
            {statusText}
          </span>
        )}
        {canEdit && !editing && text.trim() && (
          <button type="button" className="underline" onClick={() => setEditing(true)}>
            {t("tasks.notes.edit")}
          </button>
        )}
        <span>{canEdit ? t("tasks.notes.shared") : t("tasks.notes.readOnly")}</span>
      </div>
    </div>
  );
}
