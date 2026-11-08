import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { PlanogramEditor } from "@/components/planograms/planogram-editor";
import { t } from "@/lib/i18n";
import { requireUser } from "@/modules/core/auth/current-user";
import { canManagePlanograms } from "@/modules/planograms/access";
import { editorData } from "@/modules/planograms/editor-data";
import { loadPlanogram } from "@/modules/planograms/repository";

import { saveLayoutAction } from "../../actions";

export default async function EditPlanogramPage({
  params,
  searchParams,
}: PageProps<"/planograms/[id]/edit">) {
  const user = await requireUser();
  const { id } = await params;
  const { dropped } = await searchParams;
  const loaded = await loadPlanogram(id);
  if (!loaded) notFound();
  const editable =
    canManagePlanograms(user.role) &&
    (loaded.record.status === "DRAFT" || loaded.record.status === "PENDING_APPROVAL");
  if (!editable) redirect(`/planograms/${id}`);
  const data = await editorData(loaded);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-medium">
          {loaded.record.title} · {t("planograms.version", { version: loaded.record.version })}
        </h2>
        <Link className="text-sm underline" href={`/planograms/${id}`}>
          ← {loaded.record.title}
        </Link>
      </div>
      {typeof dropped === "string" && (
        <p role="status" className="rounded-md bg-amber-500/10 p-3 text-sm">
          {t("planograms.editor.dropped", { names: dropped })}
        </p>
      )}
      <p className="text-muted-foreground text-sm md:hidden">{t("planograms.editor.readOnly")}</p>
      <div className="hidden md:block">
        <PlanogramEditor
          planogramId={id}
          geometry={loaded.geometry}
          initialLayout={loaded.layout}
          initialHeaderId={loaded.record.headerPosmId}
          initialShelftalkers={loaded.shelftalkers}
          rules={loaded.rules}
          pendingApproval={loaded.record.status === "PENDING_APPROVAL"}
          save={saveLayoutAction}
          {...data}
        />
      </div>
    </div>
  );
}
