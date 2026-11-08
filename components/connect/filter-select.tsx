"use client";

import type { ComponentProps } from "react";

import { NativeSelect } from "@/components/ui/native-select";

// A filter list that applies as soon as something is chosen: it sends its form, no «Показать».
export function FilterSelect(props: ComponentProps<typeof NativeSelect>) {
  return <NativeSelect {...props} onChange={(e) => e.currentTarget.form?.requestSubmit()} />;
}
