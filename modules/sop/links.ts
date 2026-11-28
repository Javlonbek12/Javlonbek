// Links between the pages of «S&OP». An SKU is addressed by its key (factory and name), which
// may hold any characters, so the link carries it as base64url.

export const skuHref = (key: string) =>
  `/sop/sku/${Buffer.from(key, "utf8").toString("base64url")}`;

export function skuKeyOf(param: string): string | null {
  if (!/^[A-Za-z0-9_-]{1,800}$/.test(param)) return null;
  try {
    return Buffer.from(param, "base64url").toString("utf8");
  } catch {
    return null;
  }
}

// «Ошибки и риски» with a filter set.
export function findingsHref(filter: Record<string, string | number | undefined> = {}): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(filter))
    if (value !== undefined && value !== "") search.set(key, String(value));
  const query = search.toString();
  return query ? `/sop/findings?${query}` : "/sop/findings";
}
