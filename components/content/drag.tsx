"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";

import { movePostAction } from "@/app/(app)/content/actions";
import { cn } from "@/lib/utils";

// Dragging posts between days in the calendar changes their date.
const TYPE = "application/x-content-post";

export function DraggablePost({
  id,
  date,
  enabled,
  children,
}: {
  id: string;
  date: string;
  enabled: boolean;
  children: ReactNode;
}) {
  if (!enabled) return <>{children}</>;
  return (
    <div
      draggable
      className="cursor-grab active:cursor-grabbing"
      onDragStart={(e) => {
        e.dataTransfer.setData(TYPE, JSON.stringify({ id, date }));
        e.dataTransfer.effectAllowed = "move";
      }}
    >
      {children}
    </div>
  );
}

export function DropDay({
  date,
  className,
  children,
  errorText,
}: {
  date: string;
  className?: string;
  children: ReactNode;
  errorText: string;
}) {
  const router = useRouter();
  const [over, setOver] = useState(false);
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();
  return (
    <div
      className={cn(
        className,
        over && "bg-primary/10 ring-primary/50 ring-2 ring-inset",
        pending && "opacity-60",
      )}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes(TYPE)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        setOver(false);
        const raw = e.dataTransfer.getData(TYPE);
        if (!raw) return;
        e.preventDefault();
        const post = JSON.parse(raw) as { id: string; date: string };
        if (post.date === date) return;
        startTransition(async () => {
          const result = await movePostAction(post.id, date);
          setFailed(!result.ok);
          router.refresh();
        });
      }}
    >
      {children}
      {failed && <span className="text-destructive px-1 text-[10px]">{errorText}</span>}
    </div>
  );
}
