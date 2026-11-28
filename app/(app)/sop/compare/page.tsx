import { CompareView } from "@/components/sop/compare";
import { dateFormat, t } from "@/lib/i18n";
import { requireUser } from "@/modules/core/auth/current-user";
import { getSettings } from "@/modules/core/settings/service";
import { compareUploads, forecastAccuracy } from "@/modules/sop/compare";
import { loadSopData } from "@/modules/sop/load";
import { baselineOf, loadSopModel } from "@/modules/sop/service";
import { monthLabel } from "@/modules/sop/texts";

// «Сравнение»: two uploads chosen on the page; by default the one on screen against the one it
// is checked with (the previous cycle, or the earlier version of this one).
export default async function SopComparePage({ searchParams }: PageProps<"/sop/compare">) {
  const user = await requireUser();
  const [data, { timezone }, params] = await Promise.all([
    loadSopData(),
    getSettings(user.id),
    searchParams,
  ]);
  const { uploads, upload } = data;
  const day = dateFormat({ day: "numeric", month: "short", timeZone: timezone });
  const options = uploads.map((u) => ({
    id: u.id,
    label: [
      monthLabel(u.cycle),
      t(`sop.kindsShort.${u.kind}`),
      day.format(u.createdAt),
      u.fileName,
    ].join(" · "),
  }));
  const find = (id: unknown) => uploads.find((u) => u.id === id) ?? null;
  const newer = find(params.newer) ?? upload;
  const older =
    find(params.older) ??
    (newer ? baselineOf(uploads, newer) : null) ??
    uploads.find((u) => u.id !== newer?.id) ??
    null;
  const [olderModel, newerModel] =
    older && newer && older.id !== newer.id
      ? await Promise.all([loadSopModel(older.id), loadSopModel(newer.id)])
      : [null, null];
  const sides =
    older && newer && olderModel && newerModel
      ? ([
          { model: olderModel, cycle: older.cycle, kind: older.kind },
          { model: newerModel, cycle: newer.cycle, kind: newer.kind },
        ] as const)
      : null;
  return (
    <CompareView
      options={options}
      older={older?.id ?? null}
      newer={newer?.id ?? null}
      comparison={sides ? compareUploads(...sides) : null}
      accuracy={sides ? forecastAccuracy(...sides) : null}
    />
  );
}
