import { t } from "@/lib/i18n";

import type { LayoutChange, Position } from "./diff";
import { formatPrice } from "./prices";
import type { Violation } from "./validate";

const place = (positions: Position[]) => {
  const shelves = [...new Set(positions.map((p) => p.shelf + 1))];
  return t("planograms.changes.shelves", { shelves: shelves.join(", ") });
};

// One readable line per change, e.g. "Перемещено вниз: ESSE GS — полка 2 → полка 4".
export function describeChange(change: LayoutChange, names: Map<string, string>): string {
  const name = names.get(change.id) ?? "?";
  switch (change.type) {
    case "added":
      return t("planograms.changes.added", { name, where: place(change.to) });
    case "removed":
      return t("planograms.changes.removed", { name, where: place(change.from) });
    case "moved":
      return t(`planograms.changes.moved_${change.direction}`, {
        name,
        from: place(change.from),
        to: place(change.to),
      });
    case "facings":
      return t("planograms.changes.facings", { name, from: change.from, to: change.to });
    case "price":
      return t("planograms.changes.price", {
        name,
        from: change.from === null ? "—" : formatPrice(change.from),
        to: change.to === null ? "—" : formatPrice(change.to),
      });
  }
}

export function describeViolation(violation: Violation): string {
  return t(
    `planograms.violations.${violation.message}` as Parameters<typeof t>[0],
    violation.params,
  );
}
