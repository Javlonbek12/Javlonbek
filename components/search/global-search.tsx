"use client";

import {
  CalendarClock,
  ClipboardList,
  Compass,
  FolderKanban,
  LayoutGrid,
  ListTodo,
  Loader2,
  Megaphone,
  Plus,
  Search,
  UserRound,
  X,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, type ChangeEvent, type KeyboardEvent } from "react";

import { useT } from "@/components/locale-provider";
import { startNavigationProgress } from "@/components/navigation-progress";
import { cn } from "@/lib/utils";
import { MODULES } from "@/modules/core/registry";
import { MIN_QUERY, type SearchGroup, type SearchHit } from "@/modules/search/types";

const KIND_ICON: Record<Exclude<SearchHit["kind"], "section">, LucideIcon> = {
  action: Plus,
  person: UserRound,
  responsibility: ClipboardList,
  task: ListTodo,
  meeting: CalendarClock,
  project: FolderKanban,
  content: Megaphone,
  planogram: LayoutGrid,
};

function hitIcon(hit: SearchHit): LucideIcon {
  if (hit.more) return Search;
  if (hit.kind === "section") return MODULES.find((m) => m.id === hit.module)?.icon ?? Compass;
  return KIND_ICON[hit.kind];
}

type Found = { query: string; groups: SearchGroup[]; failed: boolean };

// Asks the server a moment after the person stops typing; an older answer never replaces a newer.
function useSearch(query: string) {
  const q = query.trim();
  const [found, setFound] = useState<Found>({ query: "", groups: [], failed: false });
  useEffect(() => {
    if (q.length < MIN_QUERY) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/search?${new URLSearchParams({ q })}`, {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`search: ${response.status}`);
        const { groups } = (await response.json()) as { groups: SearchGroup[] };
        setFound({ query: q, groups, failed: false });
      } catch {
        if (!controller.signal.aborted) setFound({ query: q, groups: [], failed: true });
      }
    }, 200);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [q]);
  const short = q.length < MIN_QUERY;
  return {
    short,
    loading: !short && found.query !== q,
    // While the next answer is on its way, the last one stays (no flicker).
    groups: short ? [] : found.groups,
    failed: !short && found.query === q && found.failed,
    empty: !short && found.query === q && !found.failed && found.groups.length === 0,
  };
}

// The search box's state and keys, shared by the desktop bar and the phone's full-screen search.
function useSearchBox(onDone: () => void) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const result = useSearch(query);
  const hits = result.groups.flatMap((group) => group.hits);
  const current = hits.length ? Math.min(active, hits.length - 1) : -1;
  const listId = useId();
  const optionId = (index: number) => `${listId}-${index}`;

  const finish = () => {
    setQuery("");
    setActive(0);
    onDone();
  };
  const go = (href: string) => {
    startNavigationProgress();
    router.push(href);
    finish();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!hits.length) return;
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((current + step + hits.length) % hits.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const q = query.trim();
      // No answer yet (or nothing found): look among the tasks, as this box always did.
      if (current >= 0) go(hits[current]!.href);
      else if (q) go(`/tasks?${new URLSearchParams({ q })}`);
    } else if (event.key === "Escape") {
      finish();
    }
  };

  return {
    query,
    result,
    input: {
      value: query,
      onChange: (event: ChangeEvent<HTMLInputElement>) => {
        setQuery(event.target.value);
        setActive(0);
      },
      onKeyDown,
      "aria-autocomplete": "list" as const,
      "aria-activedescendant": current >= 0 ? optionId(current) : undefined,
    },
    list: { id: listId, count: hits.length, current, optionId, onPick: finish },
  };
}

function Results({ box, className }: { box: ReturnType<typeof useSearchBox>; className?: string }) {
  const t = useT();
  const { result, list } = box;
  // Options are numbered across the groups (for the arrow keys).
  const firstIndex = result.groups.map((_, g) =>
    result.groups.slice(0, g).reduce((sum, group) => sum + group.hits.length, 0),
  );
  const note = result.short
    ? t("shell.find.minLength")
    : result.failed
      ? t("shell.find.error")
      : result.empty
        ? t("shell.find.empty")
        : null;
  return (
    <div id={list.id} role="listbox" aria-label={t("shell.searchLabel")} className={className}>
      {note && <p className="text-muted-foreground px-4 py-3 text-sm">{note}</p>}
      {result.groups.map((group, g) => (
        <div
          key={group.key}
          role="group"
          aria-label={t(`shell.find.groups.${group.key}`)}
          className="py-1"
        >
          <div className="text-muted-foreground px-4 pt-2 pb-1 text-[11px] font-semibold tracking-wide uppercase">
            {t(`shell.find.groups.${group.key}`)}
          </div>
          {group.hits.map((hit, h) => {
            const index = firstIndex[g]! + h;
            const selected = index === list.current;
            const Icon = hitIcon(hit);
            return (
              <Link
                key={hit.id}
                id={list.optionId(index)}
                href={hit.href}
                role="option"
                aria-selected={selected}
                onClick={list.onPick}
                className={cn(
                  "flex items-center gap-3 px-4 py-2 text-sm",
                  selected ? "bg-accent" : "hover:bg-accent/60",
                )}
              >
                <span className="bg-secondary text-secondary-foreground flex size-8 shrink-0 items-center justify-center rounded-lg">
                  <Icon className="size-4" />
                </span>
                <span className="flex min-w-0 flex-col">
                  <span className={cn("truncate", hit.more ? "text-primary" : "font-medium")}>
                    {hit.title}
                  </span>
                  {hit.subtitle && (
                    <span className="text-muted-foreground truncate text-xs">{hit.subtitle}</span>
                  )}
                </span>
              </Link>
            );
          })}
        </div>
      ))}
    </div>
  );
}

// Desktop: the field in the top bar with the results dropping down under it. Ctrl+K (⌘K) jumps
// into it from anywhere.
export function SearchBar() {
  const t = useT();
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLInputElement>(null);
  const box = useSearchBox(() => {
    setOpen(false);
    field.current?.blur();
  });

  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        field.current?.focus();
      }
    };
    // A press anywhere else closes the results.
    const onPointer = (event: PointerEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, []);

  return (
    <div
      ref={container}
      role="search"
      className="relative max-w-xl flex-1"
      onFocus={() => setOpen(true)}
      onBlur={(event) => {
        // Tabbing away; a press on a result keeps it open until the click lands.
        if (event.relatedTarget && !container.current?.contains(event.relatedTarget)) {
          setOpen(false);
        }
      }}
    >
      <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2" />
      <input
        ref={field}
        type="search"
        role="combobox"
        placeholder={t("shell.search")}
        aria-label={t("shell.searchLabel")}
        className="bg-card focus-visible:ring-ring/40 h-11 w-full rounded-full border pr-20 pl-11 text-sm shadow-[0_1px_2px_oklch(0_0_0/0.03)] outline-none focus-visible:ring-[3px]"
        aria-controls={box.list.id}
        aria-expanded={open && box.list.count > 0}
        {...box.input}
      />
      <span className="text-muted-foreground pointer-events-none absolute top-1/2 right-4 flex -translate-y-1/2 items-center gap-2 text-xs">
        {box.result.loading && <Loader2 className="size-3.5 animate-spin" />}
        <kbd className="rounded-md border px-1.5 py-0.5 font-sans">{t("shell.find.shortcut")}</kbd>
      </span>
      {open && box.query.trim() && (
        <Results
          box={box}
          className="bg-popover text-popover-foreground absolute inset-x-0 top-full z-40 mt-2 max-h-[70vh] overflow-y-auto rounded-2xl border py-1 shadow-xl"
        />
      )}
    </div>
  );
}

// Phone: a magnifier in the header that opens the search over the whole screen.
export function SearchButton({ className }: { className?: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const box = useSearchBox(() => setOpen(false));
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t("shell.searchLabel")}
        className={cn(
          "text-muted-foreground flex size-9 items-center justify-center rounded-full",
          className,
        )}
      >
        <Search className="size-[18px]" />
      </button>
      {open && (
        <div role="search" className="bg-background fixed inset-0 z-40 flex flex-col">
          <div className="bg-card flex items-center gap-2 border-b px-3 py-2">
            <Search className="text-muted-foreground size-4 shrink-0" />
            <input
              type="search"
              role="combobox"
              autoFocus
              placeholder={t("shell.find.placeholder")}
              aria-label={t("shell.searchLabel")}
              className="h-10 min-w-0 flex-1 bg-transparent text-base outline-none"
              aria-controls={box.list.id}
              aria-expanded={box.list.count > 0}
              {...box.input}
            />
            {box.result.loading && (
              <Loader2 className="text-muted-foreground size-4 shrink-0 animate-spin" />
            )}
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label={t("shell.close")}
              className="text-muted-foreground hover:bg-accent rounded-full p-2"
            >
              <X className="size-5" />
            </button>
          </div>
          <Results box={box} className="flex-1 overflow-y-auto pb-[env(safe-area-inset-bottom)]" />
        </div>
      )}
    </>
  );
}
