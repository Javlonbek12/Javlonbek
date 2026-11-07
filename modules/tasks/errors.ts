export type TaskErrorCode =
  | "forbidden"
  | "blocked"
  | "invalid"
  | "cycle"
  | "plan"
  | "planChildren"
  | "fileTooLarge"
  | "requested"
  | "noApprover"
  | "repeatDate"
  | "reason"
  | "assigneeLocked"
  | "cancelledDependency"
  | "tooManySteps"
  | "noteTooLong"
  | "coAssigneeExists"
  | "coAssigneeRequested"
  | "tooManyCoAssignees"
  | "coAssigneeReviewer"
  | "timeInvalid";

// A task action that can't be done; `code` maps to tasks.errors.* in the i18n dictionary.
export class TaskError extends Error {
  constructor(public readonly code: TaskErrorCode) {
    super(code);
    this.name = "TaskError";
  }
}
