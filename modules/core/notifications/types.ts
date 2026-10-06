// Notification types. Add new ones here and to the i18n dictionary (notifications.types).
export const NOTIFICATION_TYPES = [
  "test",
  "invite_accepted",
  "role_changed",
  "task_pending_approval",
  "task_assigned",
  "task_status",
  "task_comment",
  "digest",
  "due_reminder",
  "overdue",
  "weekly_summary",
  "meeting_invite",
  "meeting_reminder",
  "content_assigned",
  "content_review",
  "content_feedback",
  "content_approved",
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

// Types the user can turn off in settings. Test notifications always arrive.
export const OPTIONAL_NOTIFICATION_TYPES: NotificationType[] = NOTIFICATION_TYPES.filter(
  (type) => type !== "test",
);
