"use client";

import {
  DndContext,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { ArrowDown, ArrowUp, Copy, Redo2, Sparkles, Undo2, X } from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { useT } from "@/components/locale-provider";
import { cn } from "@/lib/utils";
import { describeChange, describeViolation } from "@/modules/planograms/describe";
import { diffLayouts } from "@/modules/planograms/diff";
import { slotKey, widthInSlots, type Geometry } from "@/modules/planograms/geometry";
import {
  coveredBelow,
  coveredSlots,
  layoutProblems,
  posmArea,
  talkerRuns,
  tallPosmSlots,
  type Layout,
  type SkuInfo,
} from "@/modules/planograms/layout";
import { validatePlanogram, type Rule } from "@/modules/planograms/validate";

import { moveCell, placeAt, removeAt, swapShelves, copyShelf, toggleBadge } from "./editor-ops";
import {
  PACK_H,
  SHELF_PITCH,
  SLOT_W,
  SlotView,
  TALKER_H,
  type EditorPosm,
  type EditorSku,
} from "./slot-cell";

type SaveResult = { ok: boolean; error?: string };

type SuggestResult =
  | { ok: true; layout: Layout; note: string; unknown: string[]; overflow: string[] }
  | { ok: false; error: string };

type Props = {
  planogramId: string;
  geometry: Geometry;
  initialLayout: Layout;
  initialHeaderId: string | null;
  // The shelftalker of each shelf that has one (shelf index → POSM).
  initialShelftalkers: Record<number, string>;
  skus: EditorSku[];
  posms: EditorPosm[];
  headers: EditorPosm[];
  shelftalkers: EditorPosm[];
  rules: Rule[];
  prices: Record<string, number>;
  previous: { layout: Layout; geometry: Geometry; prices: Record<string, number> } | null;
  // The version waits for approval: saving sends it back to draft (said before saving).
  pendingApproval?: boolean;
  save: (
    planogramId: string,
    layout: string,
    headerPosmId: string | null,
    shelftalkers: string,
  ) => Promise<SaveResult>;
  // «Предложить раскладку ИИ»: only where the AI key is set.
  suggest?: (
    planogramId: string,
    layout: string,
    request: string,
    mode: AiMode,
  ) => Promise<SuggestResult>;
};

// What the AI may change: only the places nobody decided, or every pack (POSM always stays).
type AiMode = "free" | "all";
const AI_MAX = 1000;

const BADGES = ["YANGI", "1mg", "2mg"];

// What one undo step holds: the layout, the header and the shelftalkers.
type Snapshot = { layout: Layout; headerId: string | null; talkers: Record<number, string> };

// The cells a layout problem is about ("overlap:2:3" → "2:3"), and for a cell under a POSM the
// POSM itself (the cell under it isn't drawn).
function problemCells(problems: string[], layout: Layout) {
  const cells = problems.map((p) => p.slice(p.indexOf(":") + 1));
  const owners = Object.entries(layout).flatMap(([key, c]) =>
    c.kind === "POSM" && posmArea(key, c.span, c.rows).some((k) => k !== key && cells.includes(k))
      ? [key]
      : [],
  );
  return [...cells, ...owners];
}

function PaletteItem({
  id,
  label,
  color,
  onPick,
  active,
}: {
  id: string;
  label: string;
  color: string;
  onPick: () => void;
  active: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform } = useDraggable({ id });
  return (
    <button
      ref={setNodeRef}
      type="button"
      onClick={onPick}
      {...attributes}
      {...listeners}
      style={
        transform
          ? { transform: `translate(${transform.x}px, ${transform.y}px)`, zIndex: 20 }
          : undefined
      }
      className={cn(
        "hover:bg-accent flex w-full items-center gap-2 rounded-md border px-2 py-1 text-left text-xs",
        active && "border-blue-500 bg-blue-50",
      )}
    >
      <span className="size-3 shrink-0 rounded-sm" style={{ background: color }} />
      <span className="truncate">{label}</span>
    </button>
  );
}

function Cell({
  id,
  children,
  onClick,
}: {
  id: string;
  children: React.ReactNode;
  onClick: (e: React.MouseEvent) => void;
}) {
  const drop = useDroppable({ id: `slot:${id}` });
  const drag = useDraggable({ id: `cell:${id}` });
  return (
    <div
      ref={(node) => {
        drop.setNodeRef(node);
        drag.setNodeRef(node);
      }}
      {...drag.attributes}
      {...drag.listeners}
      data-slot-key={id}
      onClick={onClick}
      className={cn("cursor-pointer rounded-md p-0.5", drop.isOver && "bg-blue-100")}
      style={
        drag.transform
          ? {
              transform: `translate(${drag.transform.x}px, ${drag.transform.y}px)`,
              zIndex: 20,
              position: "relative",
            }
          : undefined
      }
    >
      {children}
    </div>
  );
}

// The room between module sections in a row: ml-1 + border-l-2 + pl-1.
const SECTION_GAP = 10;

export function PlanogramEditor(props: Props) {
  const t = useT();
  const { geometry, skus, posms, rules } = props;
  // A short row (the top of a LEGO) skips the room between the sections of the rows under it.
  const section = geometry.shelves.find((s) => s.group > 0)?.group ?? 0;
  const sectionGaps = (column: number) =>
    section > 0 ? Math.floor(column / section) * SECTION_GAP : 0;
  // Only shelves that hold a shelftalker keep one (as saved).
  const keptTalkers = useCallback(
    (talkers: Record<number, string>) =>
      Object.fromEntries(
        Object.entries(talkers).filter(
          ([shelf, id]) => id && geometry.shelves[Number(shelf)]?.talker,
        ),
      ),
    [geometry],
  );
  // A snapshot in a form that compares: the same content gives the same text.
  const snapshotKey = useCallback(
    (s: Snapshot) =>
      JSON.stringify([
        Object.entries(s.layout).sort(([a], [b]) => a.localeCompare(b)),
        s.headerId,
        Object.entries(keptTalkers(s.talkers)).sort(([a], [b]) => a.localeCompare(b)),
      ]),
    [keptTalkers],
  );
  const [state, setState] = useState(() => ({
    current: {
      layout: props.initialLayout,
      headerId: props.initialHeaderId,
      talkers: props.initialShelftalkers,
    } as Snapshot,
    past: [] as Snapshot[],
    future: [] as Snapshot[],
  }));
  const { headerId, talkers } = state.current;
  // «Unsaved» = differs from what was saved last (undoing back to it is not a change).
  const [savedKey, setSavedKey] = useState(() => snapshotKey(state.current));
  const dirty = snapshotKey(state.current) !== savedKey;
  const [stillPending, setStillPending] = useState(Boolean(props.pendingApproval));
  // The same id on the server and in the browser (dnd-kit's own counter differs between them).
  const dndId = useId();
  const [selection, setSelection] = useState<string[]>([]);
  const [brush, setBrush] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  // A move refused because the layout would not fit: the reason and the cells to show.
  const [blocked, setBlocked] = useState<{ text: string; cells: string[] } | null>(null);
  const [pending, startTransition] = useTransition();
  // The AI panel: open or not, the request, and what came back (said under the request).
  const [ai, setAi] = useState<{
    open: boolean;
    request: string;
    mode: AiMode;
    lines: string[];
    error: boolean;
  }>({ open: false, request: "", mode: "free", lines: [], error: false });
  // The places the AI changed, with what it put there: outlined while they still hold it.
  const [aiMarks, setAiMarks] = useState<Record<string, string>>({});
  const [thinking, startThinking] = useTransition();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const skuById = useMemo(() => new Map(skus.map((s) => [s.id, s])), [skus]);
  const posmById = useMemo(
    () => new Map([...posms, ...props.headers, ...props.shelftalkers].map((p) => [p.id, p])),
    [posms, props.headers, props.shelftalkers],
  );
  // Shelf to shelf: a shelftalker strip is taller than the plain board.
  const pitch = (shelf: number) =>
    SHELF_PITCH + (geometry.shelves[shelf]?.talker ? TALKER_H - 4 : 0);
  // A POSM over several shelves reaches the lowest one's edge (cell padding, the row's padding,
  // then its shelftalker or board): level with that shelf's shelftalker.
  const posmHeight = (shelf: number, rows: number) =>
    PACK_H +
    20 +
    Array.from({ length: rows - 1 }, (_, k) => pitch(shelf + k)).reduce((a, b) => a + b, 0) +
    2 +
    4 +
    (geometry.shelves[shelf + rows - 1]?.talker ? TALKER_H : 4);
  const layout = state.current.layout;
  const covered = coveredSlots(layout);
  // Cells that don't fit now (e.g. a layout saved before a POSM got taller): shown in red.
  const problems = layoutProblems(layout, geometry);
  const problemSet = new Set([...problemCells(problems, layout), ...(blocked?.cells ?? [])]);
  // Behind such a POSM the shelf has no shelftalker (it is printed shorter there).
  const tall = tallPosmSlots(layout);
  // Where a place starts in its row: the slots before it and the room between module sections.
  const placeLeft = (shelf: { group: number }, position: number) =>
    position * SLOT_W + (shelf.group > 0 ? Math.floor(position / shelf.group) * SECTION_GAP : 0);
  // Under a POSM hanging from the shelf above: an empty place, the block is drawn over it.
  const below = coveredBelow(layout);

  const commit = useCallback((patch: Partial<Snapshot>) => {
    setBlocked(null);
    setState((s) => ({
      current: { ...s.current, ...patch },
      past: [...s.past.slice(-99), s.current],
      future: [],
    }));
  }, []);
  // A change that would leave something outside the equipment or on top of something else (a
  // shelf moved under a POSM over several shelves) is refused with the reason, not saved broken.
  const apply = (next: Layout | null) => {
    if (!next) return;
    const before = new Set(problems);
    const added = layoutProblems(next, geometry).filter((p) => !before.has(p));
    if (added.length > 0) {
      setBlocked({ text: t("planograms.editor.blocked"), cells: problemCells(added, next) });
      return;
    }
    commit({ layout: next });
  };
  const undo = useCallback(() => {
    setBlocked(null);
    setState((s) =>
      s.past.length
        ? { current: s.past.at(-1)!, past: s.past.slice(0, -1), future: [s.current, ...s.future] }
        : s,
    );
  }, []);
  const redo = useCallback(() => {
    setBlocked(null);
    setState((s) =>
      s.future.length
        ? { current: s.future[0]!, past: [...s.past, s.current], future: s.future.slice(1) }
        : s,
    );
  }, []);
  // Leaving with unsaved changes asks first: closing the tab, and links inside the app.
  useEffect(() => {
    if (!dirty) return;
    const onUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    const onClick = (e: MouseEvent) => {
      const link = (e.target as HTMLElement | null)?.closest?.("a[href]");
      if (!link || link.getAttribute("target") === "_blank" || e.defaultPrevented) return;
      if (window.confirm(t("planograms.editor.leave"))) return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener("beforeunload", onUnload);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", onUnload);
      document.removeEventListener("click", onClick, true);
    };
  }, [dirty, t]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || (e.target as HTMLElement).tagName === "INPUT") return;
      if (e.key.toLowerCase() === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if (e.key.toLowerCase() === "y" || (e.key.toLowerCase() === "z" && e.shiftKey)) {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo]);

  const contentFor = (itemId: string) => {
    const [kind, id] = itemId.split(":");
    if (kind === "sku") {
      const sku = skuById.get(id)!;
      return {
        kind: "SKU" as const,
        skuId: id,
        badges: [...new Set([...(sku.isNew ? ["YANGI"] : []), ...sku.defaultBadges])],
      };
    }
    const posm = posmById.get(id)!;
    return { kind: "POSM" as const, posmId: id, span: posm.span, rows: posm.rows };
  };

  const placeMany = (itemId: string, keys: string[]) => {
    let next: Layout | null = layout;
    for (const key of keys)
      next = next && (placeAt(next, geometry, key, contentFor(itemId)) ?? next);
    apply(next);
  };

  const onCellClick = (key: string, e: React.MouseEvent) => {
    if (brush) return placeMany(brush, [key]);
    if (e.shiftKey || e.ctrlKey || e.metaKey)
      setSelection((s) => (s.includes(key) ? s.filter((k) => k !== key) : [...s, key]));
    else setSelection((s) => (s.length === 1 && s[0] === key ? [] : [key]));
  };

  const onDragEnd = (event: DragEndEvent) => {
    const target = String(event.over?.id ?? "");
    if (!target.startsWith("slot:")) return;
    const key = target.slice(5);
    const source = String(event.active.id);
    if (source.startsWith("cell:")) apply(moveCell(layout, geometry, source.slice(5), key));
    else placeMany(source, [key]);
  };

  const skuInfos: SkuInfo[] = skus;
  const violations = useMemo(
    () => validatePlanogram(layout, geometry, skuInfos, rules),
    [layout, geometry, skuInfos, rules],
  );
  const badCells = new Set([...violations.flatMap((v) => v.cells), ...problemSet]);
  const changes = useMemo(() => {
    if (!props.previous) return [];
    const names = new Map<string, string>([
      ...skus.map((s) => [s.id, s.name] as const),
      ...[...posmById.values()].map((p) => [p.id, p.name] as const),
    ]);
    return diffLayouts(
      {
        layout: props.previous.layout,
        geometry: props.previous.geometry,
        prices: new Map(Object.entries(props.previous.prices)),
      },
      { layout, geometry, prices: new Map(Object.entries(props.prices)) },
    ).map((c) => describeChange(c, names));
  }, [layout, geometry, props.previous, props.prices, skus, posmById]);

  const filtered = skus.filter((s) =>
    `${s.code} ${s.name}`.toLowerCase().includes(query.toLowerCase()),
  );
  const selectedSkus = selection.filter((k) => layout[k]?.kind === "SKU");

  const onSave = () => {
    // A layout that doesn't fit is not sent: the cells are red and the reason is said here.
    if (problems.length > 0) {
      setBlocked({ text: t("planograms.editor.problems"), cells: problemCells(problems, layout) });
      return;
    }
    const snapshot = state.current;
    startTransition(async () => {
      const result = await props.save(
        props.planogramId,
        JSON.stringify(snapshot.layout),
        snapshot.headerId,
        JSON.stringify(keptTalkers(snapshot.talkers)),
      );
      setMessage(
        result.ok
          ? t("planograms.actions.saved")
          : t(`planograms.errors.${result.error ?? "invalid"}` as never),
      );
      if (result.ok) {
        setSavedKey(snapshotKey(snapshot));
        setStillPending(false);
      }
    });
  };

  const onSuggest = () => {
    const suggest = props.suggest;
    const request = ai.request.trim();
    if (!suggest || !request) return;
    const before = layout;
    startThinking(async () => {
      const result = await suggest(props.planogramId, JSON.stringify(before), request, ai.mode);
      if (!result.ok) {
        setAi((a) => ({ ...a, lines: [t(result.error as never)], error: true }));
        return;
      }
      // One step in the history: undo takes the whole suggestion back.
      apply(result.layout);
      setSelection([]);
      // What the AI changed (outlined on the shelves) and the places it left undecided.
      const text = (c: Layout[string] | undefined) => JSON.stringify(c ?? null);
      const marks: Record<string, string> = {};
      for (const key of new Set([...Object.keys(before), ...Object.keys(result.layout)]))
        if (text(before[key]) !== text(result.layout[key])) marks[key] = text(result.layout[key]);
      setAiMarks(marks);
      const after = coveredSlots(result.layout);
      const unfilled = geometry.shelves
        .map((shelf, index) => ({
          shelf: index + 1,
          count: Array.from({ length: shelf.slots }, (_, p) => slotKey(index, p)).filter(
            (key) => !result.layout[key] && !after.has(key),
          ).length,
        }))
        .filter((x) => x.count > 0);
      setAi((a) => ({
        ...a,
        error: false,
        lines: [
          result.note,
          result.unknown.length > 0
            ? t("planograms.editor.ai.unknown", { codes: result.unknown.join(", ") })
            : "",
          result.overflow.length > 0
            ? t("planograms.editor.ai.overflow", { names: result.overflow.join(", ") })
            : "",
          unfilled.length > 0
            ? t("planograms.editor.ai.unfilled", {
                count: unfilled.reduce((n, x) => n + x.count, 0),
                shelves: unfilled
                  .map((x) => `${t("planograms.editor.shelf", { n: x.shelf })}: ${x.count}`)
                  .join(", "),
              })
            : "",
          t("planograms.editor.ai.done", { count: Object.keys(marks).length }),
        ].filter(Boolean),
      }));
    });
  };
  const aiMarked = (key: string) =>
    key in aiMarks && aiMarks[key] === JSON.stringify(layout[key] ?? null);
  // A violation pressed: its cells are selected (to fix them at once) and shown.
  const showCells = (cells: string[]) => {
    if (cells.length === 0) return;
    setBrush(null);
    setSelection(cells);
    document
      .querySelector(`[data-slot-key="${cells[0]}"]`)
      ?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
  };

  return (
    <DndContext id={dndId} sensors={sensors} onDragEnd={onDragEnd}>
      <div className="flex flex-col gap-3 lg:grid lg:grid-cols-[15rem_minmax(0,1fr)] xl:grid-cols-[15rem_minmax(0,1fr)_18rem]">
        <aside className="flex w-full min-w-0 flex-col gap-2 lg:row-span-2 xl:row-span-1">
          <h3 className="text-sm font-medium">{t("planograms.editor.palette")}</h3>
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("planograms.editor.search")}
          />
          <div className="flex max-h-[420px] flex-col gap-1 overflow-y-auto pr-1">
            <span className="text-muted-foreground text-xs">{t("planograms.editor.skus")}</span>
            {filtered.map((s) => (
              <PaletteItem
                key={s.id}
                id={`sku:${s.id}`}
                label={`${s.name}${s.isMandatory ? " ★" : ""}`}
                color={s.color}
                active={brush === `sku:${s.id}`}
                onPick={() => setBrush((b) => (b === `sku:${s.id}` ? null : `sku:${s.id}`))}
              />
            ))}
            <span className="text-muted-foreground mt-2 text-xs">
              {t("planograms.editor.posm")}
            </span>
            {posms.map((p) => (
              <PaletteItem
                key={p.id}
                id={`posm:${p.id}`}
                label={`${p.name} (${p.span})`}
                color={p.color}
                active={brush === `posm:${p.id}`}
                onPick={() => setBrush((b) => (b === `posm:${p.id}` ? null : `posm:${p.id}`))}
              />
            ))}
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={undo}
              disabled={!state.past.length}
              aria-label={t("planograms.editor.undo")}
            >
              <Undo2 />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={redo}
              disabled={!state.future.length}
              aria-label={t("planograms.editor.redo")}
            >
              <Redo2 />
            </Button>
            {geometry.header && (
              <NativeSelect
                value={headerId ?? ""}
                onChange={(e) => commit({ headerId: e.target.value || null })}
                aria-label={t("planograms.fields.header")}
              >
                <option value="">{t("planograms.fields.noHeader")}</option>
                {props.headers.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.name}
                  </option>
                ))}
              </NativeSelect>
            )}
            {props.suggest && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-expanded={ai.open}
                onClick={() => setAi((a) => ({ ...a, open: !a.open }))}
              >
                <Sparkles />
                {t("planograms.editor.ai.open")}
              </Button>
            )}
            <Button type="button" onClick={onSave} disabled={pending}>
              {t("planograms.actions.save")}
            </Button>
            {dirty && (
              <span className="text-xs text-amber-600">{t("planograms.editor.unsaved")}</span>
            )}
            {message && !dirty && <span className="text-muted-foreground text-xs">{message}</span>}
          </div>
          {ai.open && props.suggest && (
            <div className="bg-muted/40 flex flex-col gap-2 rounded-lg border p-3 text-sm">
              <div className="flex items-start justify-between gap-2">
                <label htmlFor={`${dndId}-ai`} className="font-medium">
                  {t("planograms.editor.ai.title")}
                </label>
                <button
                  type="button"
                  className="text-muted-foreground hover:text-foreground"
                  onClick={() => setAi((a) => ({ ...a, open: false }))}
                  aria-label={t("planograms.editor.ai.close")}
                >
                  <X className="size-4" />
                </button>
              </div>
              <fieldset className="flex flex-col gap-1">
                <legend className="sr-only">{t("planograms.editor.ai.mode")}</legend>
                {(["free", "all"] as const).map((mode) => (
                  <label key={mode} className="flex items-start gap-2">
                    <input
                      type="radio"
                      name={`${dndId}-ai-mode`}
                      value={mode}
                      checked={ai.mode === mode}
                      onChange={() => setAi((a) => ({ ...a, mode }))}
                      className="mt-0.5 size-4"
                    />
                    <span>
                      <span className="font-medium">
                        {t(
                          mode === "free"
                            ? "planograms.editor.ai.modeFree"
                            : "planograms.editor.ai.modeAll",
                        )}
                      </span>{" "}
                      <span className="text-muted-foreground text-xs">
                        {t(
                          mode === "free"
                            ? "planograms.editor.ai.modeFreeHint"
                            : "planograms.editor.ai.modeAllHint",
                        )}
                      </span>
                    </span>
                  </label>
                ))}
              </fieldset>
              <Textarea
                id={`${dndId}-ai`}
                value={ai.request}
                maxLength={AI_MAX}
                rows={3}
                onChange={(e) => setAi((a) => ({ ...a, request: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) onSuggest();
                }}
                placeholder={t("planograms.editor.ai.placeholder")}
              />
              <p className="text-muted-foreground flex flex-wrap justify-between gap-2 text-xs">
                <span>{t("planograms.editor.ai.hint")}</span>
                <span className="tabular-nums">
                  {ai.request.length} / {AI_MAX}
                </span>
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  onClick={onSuggest}
                  disabled={thinking || !ai.request.trim()}
                >
                  <Sparkles />
                  {thinking ? t("planograms.editor.ai.thinking") : t("planograms.editor.ai.submit")}
                </Button>
              </div>
              {ai.lines.length > 0 && !thinking && (
                <div
                  role={ai.error ? "alert" : "status"}
                  className={cn(
                    "flex flex-col gap-1 rounded-md p-2",
                    ai.error ? "bg-destructive/10 text-destructive" : "bg-card border",
                  )}
                >
                  {ai.lines.map((line, i) => (
                    <p key={i}>{line}</p>
                  ))}
                </div>
              )}
            </div>
          )}
          {stillPending && (
            <p className="text-sm text-amber-700 dark:text-amber-300">
              {t("planograms.editor.pendingWarning")}
            </p>
          )}
          {blocked && (
            <p role="alert" className="bg-destructive/10 text-destructive rounded-md p-2 text-sm">
              {blocked.text}
            </p>
          )}
          <p className="text-muted-foreground text-xs">
            {brush
              ? t("planograms.editor.brush", {
                  name:
                    (skuById.get(brush.split(":")[1])?.name ??
                      posmById.get(brush.split(":")[1])?.name) ||
                    "",
                })
              : t("planograms.editor.dragHint")}{" "}
            {brush && (
              <button type="button" className="underline" onClick={() => setBrush(null)}>
                {t("planograms.editor.clearBrush")}
              </button>
            )}
          </p>

          {selection.length > 0 && !brush && (
            <div className="bg-muted/50 flex flex-wrap items-center gap-2 rounded-lg p-2 text-sm">
              <span>{t("planograms.editor.selected", { count: selection.length })}</span>
              <NativeSelect
                value=""
                onChange={(e) => e.target.value && placeMany(e.target.value, selection)}
                aria-label={t("planograms.editor.fill")}
              >
                <option value="">{t("planograms.editor.fill")}…</option>
                {skus.map((s) => (
                  <option key={s.id} value={`sku:${s.id}`}>
                    {s.name}
                  </option>
                ))}
              </NativeSelect>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => apply(selection.reduce((l, k) => removeAt(l, k), layout))}
              >
                {t("planograms.editor.clear")}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() =>
                  apply(
                    selection.reduce<Layout>(
                      (l, k) => placeAt(l, geometry, k, { kind: "EMPTY" }) ?? l,
                      layout,
                    ),
                  )
                }
              >
                {t("planograms.editor.markEmpty")}
              </Button>
              {selectedSkus.length > 0 &&
                BADGES.map((b) => (
                  <Button
                    key={b}
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => apply(toggleBadge(layout, selectedSkus, b))}
                  >
                    {b}
                  </Button>
                ))}
            </div>
          )}

          <div className="overflow-x-auto rounded-lg border bg-white p-3">
            {geometry.header &&
              (headerId && posmById.get(headerId)?.imageUrl ? (
                // The header picture at its own proportions over the shelves' width.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={posmById.get(headerId)!.imageUrl!}
                  alt={posmById.get(headerId)!.name}
                  className="mb-2 ml-[72px] block h-auto rounded-md object-contain"
                  style={{
                    width: widthInSlots(geometry) * SLOT_W,
                    maxHeight: widthInSlots(geometry) * SLOT_W * 0.45,
                    background: posmById.get(headerId)!.color,
                  }}
                />
              ) : (
                <div
                  className="mb-2 flex h-10 items-center justify-center rounded-md text-xs font-bold text-white"
                  style={{ background: headerId ? posmById.get(headerId)?.color : "#e2e8f0" }}
                >
                  {headerId ? posmById.get(headerId)?.name : t("planograms.fields.noHeader")}
                </div>
              ))}
            {geometry.shelves.map((shelf, shelfIndex) => (
              <div key={shelfIndex} className="mb-3 flex items-end gap-2">
                <div className="flex w-16 shrink-0 flex-col items-start gap-0.5 text-[10px]">
                  <span className="text-muted-foreground">
                    {t("planograms.editor.shelf", { n: shelfIndex + 1 })}
                  </span>
                  <span className="flex">
                    <button
                      type="button"
                      title={t("planograms.editor.moveUp")}
                      onClick={() =>
                        apply(swapShelves(layout, geometry, shelfIndex, shelfIndex - 1))
                      }
                      className="p-0.5"
                    >
                      <ArrowUp className="size-3" />
                    </button>
                    <button
                      type="button"
                      title={t("planograms.editor.moveDown")}
                      onClick={() =>
                        apply(swapShelves(layout, geometry, shelfIndex, shelfIndex + 1))
                      }
                      className="p-0.5"
                    >
                      <ArrowDown className="size-3" />
                    </button>
                    <button
                      type="button"
                      title={t("planograms.editor.copyShelf")}
                      onClick={() => apply(copyShelf(layout, geometry, shelfIndex, shelfIndex + 1))}
                      className="p-0.5"
                    >
                      <Copy className="size-3" />
                    </button>
                  </span>
                  {shelf.talker && (
                    <select
                      value={talkers[shelfIndex] ?? ""}
                      onChange={(e) =>
                        commit({ talkers: { ...talkers, [shelfIndex]: e.target.value } })
                      }
                      title={t("planograms.editor.shelftalker")}
                      aria-label={`${t("planograms.editor.shelf", { n: shelfIndex + 1 })} · ${t("planograms.editor.shelftalker")}`}
                      className="w-16 truncate rounded border bg-white text-[10px]"
                    >
                      <option value="">{t("planograms.editor.noShelftalker")}</option>
                      {props.shelftalkers.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
                <div
                  className="flex flex-col"
                  style={{ marginLeft: shelf.offset * SLOT_W + sectionGaps(shelf.offset) }}
                >
                  <div className={cn("flex pb-1", !shelf.talker && "border-b-4 border-slate-400")}>
                    {Array.from({ length: shelf.slots }, (_, position) => {
                      const key = slotKey(shelfIndex, position);
                      if (below.has(key))
                        return (
                          <div
                            key={key}
                            className={cn(
                              shelf.group > 0 &&
                                position > 0 &&
                                position % shelf.group === 0 &&
                                "ml-1 border-l-2 border-slate-300 pl-1",
                            )}
                          >
                            <div className="p-0.5">
                              <div style={{ width: SLOT_W - 4, height: PACK_H + 20 }} />
                            </div>
                          </div>
                        );
                      if (covered.has(key)) return null;
                      const content = layout[key];
                      return (
                        <div
                          key={key}
                          className={cn(
                            shelf.group > 0 &&
                              position > 0 &&
                              position % shelf.group === 0 &&
                              "ml-1 border-l-2 border-slate-300 pl-1",
                          )}
                        >
                          <Cell id={key} onClick={(e) => onCellClick(key, e)}>
                            <SlotView
                              content={content}
                              sku={content?.kind === "SKU" ? skuById.get(content.skuId) : undefined}
                              posm={
                                content?.kind === "POSM" ? posmById.get(content.posmId) : undefined
                              }
                              selected={selection.includes(key)}
                              violation={badCells.has(key)}
                              marked={aiMarked(key)}
                              height={
                                content?.kind === "POSM" && content.rows > 1
                                  ? posmHeight(shelfIndex, content.rows)
                                  : undefined
                              }
                            />
                          </Cell>
                        </div>
                      );
                    })}
                  </div>
                  {shelf.talker && (
                    // The shelftalker on the shelf's edge, along the places not behind a POSM
                    // over several shelves (a combo box).
                    <div className="relative w-full" style={{ height: TALKER_H }}>
                      {talkerRuns(shelfIndex, shelf.slots, tall).map((run) => (
                        <div
                          key={run.from}
                          className="absolute top-0 flex items-center justify-center overflow-hidden rounded-sm border-b-2 border-slate-400 text-[9px] font-bold text-white"
                          style={{
                            left: placeLeft(shelf, run.from),
                            width: placeLeft(shelf, run.to) + SLOT_W - placeLeft(shelf, run.from),
                            height: TALKER_H,
                            background: talkers[shelfIndex]
                              ? (posmById.get(talkers[shelfIndex]!)?.color ?? "#94a3b8")
                              : "#e2e8f0",
                          }}
                        >
                          {talkers[shelfIndex] && posmById.get(talkers[shelfIndex]!)?.imageUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={posmById.get(talkers[shelfIndex]!)!.imageUrl!}
                              alt={posmById.get(talkers[shelfIndex]!)!.name}
                              className="h-full w-full object-fill"
                            />
                          ) : (
                            <span className="truncate px-1 text-slate-600">
                              {talkers[shelfIndex]
                                ? posmById.get(talkers[shelfIndex]!)?.name
                                : t("planograms.editor.noShelftalker")}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
        {/* The rule check beside the shelves on a wide screen, staying in view while scrolling. */}
        <aside className="flex w-full min-w-0 flex-col gap-3 lg:col-start-2 xl:sticky xl:top-4 xl:col-start-3 xl:max-h-[calc(100vh-2rem)] xl:self-start xl:overflow-y-auto">
          <section className="rounded-lg border p-3">
            <h3 className="mb-2 text-sm font-medium">{t("planograms.validation.title")}</h3>
            {violations.length === 0 ? (
              <p className="text-sm">{t("planograms.validation.ok")}</p>
            ) : (
              <ul className="flex flex-col gap-1 text-sm">
                {violations.map((v, i) => (
                  <li
                    key={i}
                    className={cn(
                      v.severity === "CRITICAL"
                        ? "text-destructive"
                        : "text-amber-700 dark:text-amber-300",
                    )}
                  >
                    {v.cells.length > 0 ? (
                      <button
                        type="button"
                        onClick={() => showCells(v.cells)}
                        title={t("planograms.editor.showCells")}
                        className="text-left underline decoration-dotted underline-offset-2 hover:decoration-solid"
                      >
                        {v.severity === "CRITICAL" ? "⛔" : "⚠️"} {describeViolation(v)}
                      </button>
                    ) : (
                      <>
                        {v.severity === "CRITICAL" ? "⛔" : "⚠️"} {describeViolation(v)}
                      </>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="rounded-lg border p-3">
            <h3 className="mb-2 text-sm font-medium">{t("planograms.changes.title")}</h3>
            {changes.length === 0 ? (
              <p className="text-muted-foreground text-sm">{t("planograms.changes.none")}</p>
            ) : (
              <ul className="flex flex-col gap-1 text-sm">
                {changes.map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              </ul>
            )}
          </section>
        </aside>
      </div>
    </DndContext>
  );
}
