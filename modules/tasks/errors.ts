export type TaskErrorCode =
  | "forbidden"
  | "blocked"
  | "invalid"
  | "cycle"
  | "plan"
  | "fileTooLarge"
  | "requested"
  | "noApprover"
  | "repeatDate"
  | "reason"
  | "assigneeLocked"
  | "cancelledDependency";

// A task action that can't be done; `code` maps to tasks.errors.* in the i18n dictionary.
export class TaskError extends Error {
  constructor(public readonly code: TaskErrorCode) {
    super(code);
    this.name = "TaskError";
  }
}
