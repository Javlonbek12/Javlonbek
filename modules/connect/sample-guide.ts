import type { ConnectKind } from "@/lib/generated/prisma/enums";
import { t } from "@/lib/i18n";

import type { Cell } from "./parse";
import { CONNECT_SAMPLES, SAMPLE_MARK } from "./samples";

// What an upload of each kind does to what is stored (the same four rules the importer has,
// see saveRows in service.ts): said next to every sample, so nobody is surprised by a replace.
export const SAMPLE_EFFECT = {
  SU_VISIT: "days",
  SU_PERSON: "update",
  VISIT: "update",
  OOS: "update",
  ORDER: "update",
  PAYMENT: "update",
  AUDIT: "update",
  ISM_CHECK: "update",
  ROUTE: "month",
  CLIENT: "all",
  SU_POSITION: "all",
  SALE: "days",
} as const satisfies Record<ConnectKind, "update" | "days" | "month" | "all">;

// The first sheet of the samples file, «Что загружать»: a row per kind of data (what it is, where
// it is exported from, what an upload does, its sample sheet and the columns it cannot do
// without), then how to use the file. In the current language.
export function sampleGuide(kinds?: ConnectKind[]): { sheet: string; rows: Cell[][] } {
  const samples = CONNECT_SAMPLES.filter((s) => !kinds || kinds.includes(s.kind));
  return {
    sheet: t("connect.samples.guide.sheet"),
    rows: [
      [
        t("connect.samples.guide.data"),
        t("connect.samples.guide.what"),
        t("connect.samples.guide.source"),
        t("connect.samples.guide.effect"),
        t("connect.samples.guide.sample"),
        t("connect.samples.guide.required"),
      ],
      ...samples.map((s) => [
        t(`connect.kinds.${s.kind}`),
        t(`connect.samples.what.${s.kind}`),
        t(`connect.samples.source.${s.kind}`),
        t(`connect.samples.effect.${SAMPLE_EFFECT[s.kind]}`),
        s.sheet,
        s.required.join(", "),
      ]),
      [],
      [t("connect.samples.guide.note1", { mark: SAMPLE_MARK })],
      [t("connect.samples.guide.note2")],
      [t("connect.samples.guide.note3")],
    ],
  };
}
