import Link from "next/link";
import { redirect } from "next/navigation";

import { ServerStatusCard } from "@/components/server-status-card";
import { t } from "@/lib/i18n";
import { requireUser } from "@/modules/core/auth/current-user";
import { getSettings } from "@/modules/core/settings/service";

// Settings → «Управление командой» → «Сервер и бэкапы» (the owner only).
export default async function ServerPage() {
  const user = await requireUser();
  if (user.role !== "OWNER") redirect("/settings");
  const { timezone } = await getSettings(user.id);
  return (
    <div className="flex flex-col gap-4">
      <Link href="/settings" className="text-muted-foreground w-fit text-sm hover:underline">
        ← {t("settings.title")}
      </Link>
      <ServerStatusCard timezone={timezone} />
    </div>
  );
}
