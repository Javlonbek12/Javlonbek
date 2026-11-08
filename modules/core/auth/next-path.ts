// Where to go after signing in: only a path inside the app ("/meetings/abc?x=1"). Anything else —
// another site ("//evil.example", "https://…", "/\\evil"), the sign-in pages themselves, control
// characters — is dropped, so the parameter can't send anyone away.
export function safeNextPath(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 500) return null;
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return null;
  // Control characters (including tabs and line breaks).
  if ([...value].some((c) => c.charCodeAt(0) < 0x20 || c.charCodeAt(0) === 0x7f)) return null;
  if (/^\/(login|invite|api)(\/|\?|$)/.test(value)) return null;
  return value === "/" ? null : value;
}

// "/login" or "/login?next=…" for the given path.
export function loginHref(next: string | null) {
  return next ? `/login?${new URLSearchParams({ next })}` : "/login";
}
