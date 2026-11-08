"use client";

import {
  DndContext,
  PointerSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import Link from "next/link";
import { useState, useTransition } from "react";

import { moveTaskAction } from "@/app/(app)/tasks/actions";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { TaskStatus } from "@/lib/generated/prisma/enums";
import { formatDay } from "@/lib/dates";
import { type TranslationKey } from "@/lib/i18n";
import { useT, useLocale } from "@/components/locale-provider";
import { cn } from "@/lib/utils";

export type KanbanCard = {
  id: string;
  title: string;
  status: TaskStatus;
  assigneeName: string;
  dueDate: string | null;
  overdue: boolean;
  blocked: boolean;
  // Statuses this user may move the card to.
  transitions: TaskStatus[];
  // Of those, the ones that need a reason (declining, sending back): asked in a small dialog.
  reasonFor: TaskStatus[];
  // A blocking task was cancelled: accepting asks to confirm it on purpose.
  despiteCancelled: boolean;
};

// A move waiting for its reason (or the «despite» tick) before it is sent.
type PendingMove = { card: KanbanCard; to: TaskStatus; reason: boolean; despite: boolean };

function MoveDialog({
  move,
  onCancel,
  onConfirm,
}: {
  move: PendingMove;
  onCancel: () => void;
  onConfirm: (extra: { reason?: string; despiteCancelled?: boolean }) => void;
}) {
  const t = useT();
  const [reason, setReason] = useState("");
  const [despite, setDespite] = useState(false);
  const ready = (!move.reason || reason.trim().length > 0) && (!move.despite || despite);
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="kanban-move-title"
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
      onKeyDown={(e) => e.key === "Escape" && onCancel()}
    >
      <form
        className="bg-card flex w-full max-w-sm flex-col gap-3 rounded-2xl border p-4 shadow-xl"
        onSubmit={(e) => {
          e.preventDefault();
          if (ready) onConfirm({ reason: reason.trim() || undefined, despiteCancelled: despite });
        }}
      >
        <span id="kanban-move-title" className="font-medium">
          {t("tasks.kanban.moveTitle", {
            title: move.card.title,
            status: t(`tasks.status.${move.to}` as TranslationKey),
          })}
        </span>
        {move.reason && (
          <Textarea
            autoFocus
            required
            maxLength={1000}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t("tasks.reason.required")}
            aria-label={t("tasks.reason.required")}
          />
        )}
        {move.despite && (
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4"
              checked={despite}
              onChange={(e) => setDespite(e.target.checked)}
            />
            {t("tasks.reason.despiteCancelled")}
          </label>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
            {t("tasks.panel.cancel")}
          </Button>
          <Button type="submit" size="sm" disabled={!ready}>
            {t("tasks.reason.confirm")}
          </Button>
        </div>
      </form>
    </div>
  );
}

function Card({ card }: { card: KanbanCard }) {
  const t = useT();
  const locale = useLocale();
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: card.id,
  });
  const style = transform
    ? { transform: `translate(${transform.x}px, ${transform.y}px)` }
    : undefined;
  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={cn(
        "bg-card touch-manipulation rounded-md border p-2 text-sm shadow-xs",
        card.transitions.length > 0 ? "cursor-grab" : "cursor-default",
        isDragging && "z-10 opacity-80 shadow-lg",
      )}
    >
      <Link href={`/tasks/${card.id}`} className="font-medium hover:underline">
        {card.title}
      </Link>
      <div className="text-muted-foreground mt-1 flex flex-wrap gap-x-2 text-xs">
        <span>{card.assigneeName}</span>
        {card.dueDate && (
          <span className={cn(card.overdue && "text-destructive font-medium")}>
            {formatDay(card.dueDate, locale)}
          </span>
        )}
        {card.blocked && <span className="text-destructive">{t("tasks.blocked")}</span>}
      </div>
    </div>
  );
}

function Column({
  status,
  cards,
  highlight,
}: {
  status: TaskStatus;
  cards: KanbanCard[];
  highlight: boolean;
}) {
  const t = useT();
  const { setNodeRef, isOver } = useDroppable({ id: status });
  return (
    <section
      ref={setNodeRef}
      className={cn(
        "bg-muted/50 flex w-64 shrink-0 flex-col gap-2 rounded-lg p-2 md:w-auto md:min-w-0 md:flex-1",
        highlight && "ring-primary/40 ring-2",
        isOver && highlight && "bg-accent",
      )}
    >
      <h3 className="flex items-center justify-between px-1 text-sm font-medium">
        {t(`tasks.status.${status}` as TranslationKey)}
        <span className="text-muted-foreground text-xs">{cards.length}</span>
      </h3>
      {cards.map((card) => (
        <Card key={card.id} card={card} />
      ))}
    </section>
  );
}

export function KanbanBoard({
  columns,
  initialCards,
}: {
  columns: TaskStatus[];
  initialCards: KanbanCard[];
}) {
  const t = useT();
  const [cards, setCards] = useState(initialCards);
  const [dragging, setDragging] = useState<KanbanCard | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingMove | null>(null);
  const [, startTransition] = useTransition();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    // On phones a short hold starts dragging, so the board can still be scrolled.
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
  );

  function move(
    card: KanbanCard,
    to: TaskStatus,
    extra: { reason?: string; despiteCancelled?: boolean } = {},
  ) {
    const previous = cards;
    setCards(
      cards.map((c) =>
        c.id === card.id ? { ...c, status: to, transitions: [], reasonFor: [] } : c,
      ),
    );
    setMessage(null);
    startTransition(async () => {
      const result = await moveTaskAction(card.id, to, extra);
      if (!result.ok) {
        setCards(previous);
        setMessage(t(`tasks.errors.${result.error}` as TranslationKey));
      }
    });
  }

  function onDragEnd(event: DragEndEvent) {
    setDragging(null);
    const card = cards.find((c) => c.id === event.active.id);
    const to = event.over?.id as TaskStatus | undefined;
    if (!card || !to || to === card.status) return;
    if (!card.transitions.includes(to)) {
      setMessage(t("tasks.kanban.moveFailed"));
      return;
    }
    const reason = card.reasonFor.includes(to);
    const despite = to === "DONE" && card.despiteCancelled;
    // A move that needs words opens a small dialog first instead of failing.
    if (reason || despite) setPending({ card, to, reason, despite });
    else move(card, to);
  }

  return (
    <div className="flex flex-col gap-2">
      {/* Dragging with a finger on a narrow screen is awkward: there the card's buttons do it. */}
      <p className="text-muted-foreground hidden text-xs md:block">{t("tasks.kanban.hint")}</p>
      <p className="text-muted-foreground text-xs md:hidden">{t("tasks.kanban.hintPhone")}</p>
      {message && (
        <p role="alert" className="bg-destructive/10 text-destructive rounded-md p-2 text-sm">
          {message}
        </p>
      )}
      <DndContext
        sensors={sensors}
        onDragStart={(e) => setDragging(cards.find((c) => c.id === e.active.id) ?? null)}
        onDragCancel={() => setDragging(null)}
        onDragEnd={onDragEnd}
      >
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-2 md:mx-0 md:px-0">
          {columns.map((status) => (
            <Column
              key={status}
              status={status}
              cards={cards.filter((c) => c.status === status)}
              highlight={dragging?.transitions.includes(status) ?? false}
            />
          ))}
        </div>
      </DndContext>
      {pending && (
        <MoveDialog
          move={pending}
          onCancel={() => setPending(null)}
          onConfirm={(extra) => {
            setPending(null);
            move(pending.card, pending.to, extra);
          }}
        />
      )}
    </div>
  );
}
