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
import type { TaskStatus } from "@/lib/generated/prisma/enums";
import { formatDay } from "@/lib/dates";
import { t, type TranslationKey } from "@/lib/i18n";
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
};

function Card({ card }: { card: KanbanCard }) {
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
            {formatDay(card.dueDate)}
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
  const [cards, setCards] = useState(initialCards);
  const [dragging, setDragging] = useState<KanbanCard | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    // On phones a short hold starts dragging, so the board can still be scrolled.
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
  );

  function onDragEnd(event: DragEndEvent) {
    setDragging(null);
    const card = cards.find((c) => c.id === event.active.id);
    const to = event.over?.id as TaskStatus | undefined;
    if (!card || !to || to === card.status) return;
    if (!card.transitions.includes(to)) {
      setMessage(t("tasks.kanban.moveFailed"));
      return;
    }
    const previous = cards;
    setCards(cards.map((c) => (c.id === card.id ? { ...c, status: to, transitions: [] } : c)));
    setMessage(null);
    startTransition(async () => {
      const result = await moveTaskAction(card.id, to);
      if (!result.ok) {
        setCards(previous);
        setMessage(t(`tasks.errors.${result.error}` as TranslationKey));
      }
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-muted-foreground text-xs">{t("tasks.kanban.hint")}</p>
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
    </div>
  );
}
