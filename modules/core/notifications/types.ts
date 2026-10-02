// Notification types. Add new ones here and to the i18n dictionary (notifications.types).
export const NOTIFICATION_TYPES = ["test", "invite_accepted", "role_changed"] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

// Types the user can turn off in settings. Test notifications always arrive.
export const OPTIONAL_NOTIFICATION_TYPES: NotificationType[] = ["invite_accepted", "role_changed"];
