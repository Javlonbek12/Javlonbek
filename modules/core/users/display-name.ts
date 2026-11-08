import { t } from "@/lib/i18n";

export function displayName(user: { firstName: string; lastName?: string | null }): string {
  return [user.firstName, user.lastName].filter(Boolean).join(" ");
}

// The name with «(отключён)» for a deactivated person: in task and meeting details, where history
// keeps showing people who no longer use the app.
export function personName(user: {
  firstName: string;
  lastName?: string | null;
  deactivatedAt?: Date | null;
}): string {
  const name = displayName(user);
  return user.deactivatedAt ? `${name} (${t("team.deactivation.mark")})` : name;
}
