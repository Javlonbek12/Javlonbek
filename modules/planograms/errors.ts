export type PlanogramErrorCode =
  | "forbidden"
  | "invalid"
  | "notDraft"
  | "critical"
  | "layout"
  | "inUse"
  | "notFound"
  | "fileTooLarge"
  | "badFile"
  | "noChanges"
  | "applied";

// `code` maps to planograms.errors.* in the i18n dictionary.
export class PlanogramError extends Error {
  constructor(public readonly code: PlanogramErrorCode) {
    super(code);
    this.name = "PlanogramError";
  }
}
