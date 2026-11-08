import Link from "next/link";
import { redirect } from "next/navigation";

import { InviteSection } from "@/components/team/invite-section";
import { t } from "@/lib/i18n";
import { requireUser } from "@/modules/core/auth/current-user";
import { invitableRoles } from "@/modules/core/permissions";
import { getSettings } from "@/modules/core/settings/service";

// Invitations outside the Team section: managers invite their people even when their role has no
// Team section. Reached from Settings → «Управление командой».
export default async function InvitesPage({ searchParams }: PageProps<"/settings/invites">) {
  const user = await requireUser();
  if (invitableRoles(user.role).length === 0) redirect("/settings");
  const { new: fresh } = await searchParams;
  const { timezone } = await getSettings(user.id);
  return (
    <div className="flex flex-col gap-4">
      <Link href="/settings" className="text-muted-foreground w-fit text-sm hover:underline">
        ← {t("settings.title")}
      </Link>
      <h1 className="text-[22px] font-medium md:text-2xl">{t("team.invites")}</h1>
      <InviteSection
        user={user}
        timezone={timezone}
        from="settings"
        fresh={typeof fresh === "string" ? fresh : undefined}
      />
    </div>
  );
}
