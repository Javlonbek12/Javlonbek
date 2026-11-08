"use client";

import Form from "next/form";
import { useEffect, useRef } from "react";

const TYPING_PAUSE_MS = 400;

// A filter form without «Показать»: typing applies after a short pause, a choice from a list at
// once. The page reloads with the new address (replace: the back button is not flooded).
export function AutoSubmitForm({
  action,
  className,
  children,
}: {
  action: string;
  className?: string;
  children: React.ReactNode;
}) {
  const form = useRef<HTMLFormElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  return (
    <Form
      ref={form}
      action={action}
      replace
      scroll={false}
      onChange={(event) => {
        if (timer.current) clearTimeout(timer.current);
        const wait = event.target instanceof HTMLSelectElement ? 0 : TYPING_PAUSE_MS;
        timer.current = setTimeout(() => form.current?.requestSubmit(), wait);
      }}
      className={className}
    >
      {children}
    </Form>
  );
}
