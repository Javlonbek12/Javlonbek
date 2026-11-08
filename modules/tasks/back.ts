// Where a task form goes after the action: back to the view it was sent from (the task page, the
// list with the task panel open, or «Сегодня» with the panel open), never anywhere else.

const ORIGIN = "http://local";

// The task section, and «Сегодня» (which opens a task in the same panel as the list).
const allowed = (pathname: string) => pathname.startsWith("/tasks") || pathname === "/";

// The address the form says to go back to, if it is one of those paths; otherwise the fallback.
export function safeBack(back: string | null | undefined, fallback: string): string {
  if (!back || !back.startsWith("/") || back.startsWith("//") || back.includes("\\"))
    return fallback;
  try {
    const url = new URL(back, ORIGIN);
    if (url.origin !== ORIGIN || !allowed(url.pathname)) return fallback;
    return url.pathname + url.search;
  } catch {
    return fallback;
  }
}

// The same address with these query values set (null removes one); old error/notice are dropped.
export function withParams(path: string, params: Record<string, string | null>): string {
  const url = new URL(path, ORIGIN);
  url.searchParams.delete("error");
  url.searchParams.delete("notice");
  for (const [key, value] of Object.entries(params)) {
    if (value === null) url.searchParams.delete(key);
    else url.searchParams.set(key, value);
  }
  return url.pathname + url.search;
}
