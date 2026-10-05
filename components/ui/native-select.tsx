import * as React from "react";

import { cn } from "@/lib/utils";

// A styled native <select>: works well on phones and without JavaScript.
function NativeSelect({ className, ...props }: React.ComponentProps<"select">) {
  return (
    <select
      data-slot="native-select"
      className={cn(
        "border-input bg-card h-9 rounded-lg border px-2 text-base shadow-xs outline-none md:text-sm",
        "focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]",
        className,
      )}
      {...props}
    />
  );
}

export { NativeSelect };
