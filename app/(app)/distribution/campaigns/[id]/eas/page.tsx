import { Download, Printer } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Section } from "@/components/connect/parts";
import { CopyHtmlButton } from "@/components/distribution/copy-html";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { t, type TranslationKey } from "@/lib/i18n";
import { requireUser } from "@/modules/core/auth/current-user";
import { loadCampaign } from "@/modules/distribution/campaign";
import { buildEas, easData, easHtml } from "@/modules/distribution/eas";
import { canManageDistribution } from "@/modules/distribution/service";

import { saveEasAction } from "../../../actions";

const BUDGET = [
  "budgetMonth",
  "budgetCategory",
  "categoryRemark",
  "team",
  "account",
  "division",
  "department",
  "pic",
  "month",
  "expensesDetails",
] as const;

// The campaign's EAS document: what the campaign knows is filled in, the rest is typed here; the
// result can be copied into the EAS editor, downloaded for Word or printed.
export default async function DistributionEasPage({
  params,
  searchParams,
}: PageProps<"/distribution/campaigns/[id]/eas">) {
  const user = await requireUser();
  const { id } = await params;
  const query = await searchParams;
  const c = await loadCampaign(id);
  if (!c) notFound();
  const manage = canManageDistribution(user) && !c.order.closed;
  const data = await easData(c);
  const doc = buildEas(c, data);
  const html = easHtml(doc);
  const plain = html
    .replace(/<\/(p|tr|li|h2|h3)>/g, "\n")
    .replace(/<\/t[dh]>/g, "\t")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
  const error = typeof query.error === "string" ? query.error : null;
  const groups = doc.summary.map((r, i) => ({
    name: [...new Set(c.items.map((x) => x.category))][i]!,
    ...r,
  }));
  const field = (name: (typeof BUDGET)[number]) => (
    <label key={name} className="flex flex-col gap-1 text-sm">
      {t(`dist.eas.fields.${name}` as TranslationKey)}
      <Input name={name} defaultValue={data[name]} maxLength={300} />
    </label>
  );

  return (
    <div className="flex flex-col gap-5 [&>*]:min-w-0">
      <div className="flex flex-col gap-1 print:hidden">
        <Link
          href={`/distribution/campaigns/${id}#order`}
          className="text-muted-foreground text-sm hover:underline"
        >
          ← {c.order.name}
        </Link>
        <h2 className="text-lg font-semibold">{t("dist.eas.title")}</h2>
      </div>
      {query.saved !== undefined && (
        <p className="text-sm text-emerald-700 dark:text-emerald-400 print:hidden">
          {t("dist.posm.saved")}
        </p>
      )}
      {error && (
        <p className="text-destructive text-sm print:hidden">
          {t(`dist.errors.${error}` as TranslationKey)}
        </p>
      )}

      <div className="grid gap-5 xl:grid-cols-2 [&>*]:min-w-0">
        {manage && (
          <form action={saveEasAction} className="flex flex-col gap-5 print:hidden">
            <input type="hidden" name="id" value={id} />
            <Section title={t("dist.eas.budget")} hint={t("dist.eas.budgetHint")}>
              <div className="grid gap-3 sm:grid-cols-2">
                {BUDGET.map(field)}
                <label className="flex flex-col gap-1 text-sm">
                  {t("dist.eas.fields.monthlyBudget")}
                  <Input
                    name="monthlyBudget"
                    inputMode="numeric"
                    defaultValue={data.monthlyBudget ?? ""}
                  />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  {t("dist.eas.fields.alreadySpent")}
                  <Input
                    name="alreadySpent"
                    inputMode="numeric"
                    defaultValue={data.alreadySpent ?? ""}
                  />
                </label>
              </div>
            </Section>
            <Section title={t("dist.eas.texts")} hint={t("dist.eas.textsHint")}>
              <label className="flex flex-col gap-1 text-sm">
                {t("dist.eas.fields.title")}
                <Input name="title" defaultValue={data.title} maxLength={300} />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                {t("dist.eas.fields.intro")}
                <Textarea name="intro" rows={2} defaultValue={data.intro} placeholder={doc.intro} />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                Background
                <Textarea name="background" rows={4} defaultValue={data.background} />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                {t("dist.eas.fields.purpose")}
                <Textarea name="purpose" rows={4} defaultValue={data.purpose} />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                Scope of work
                <Input name="scope" defaultValue={data.scope} maxLength={300} />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                Coverage
                <Textarea
                  name="coverage"
                  rows={2}
                  defaultValue={data.coverage}
                  placeholder={doc.coverage}
                />
              </label>
              {groups.length > 0 && (
                <div className="flex flex-col gap-2">
                  <span className="text-sm">{t("dist.eas.fields.groupPurpose")}</span>
                  {groups.map((g, i) => (
                    <label
                      key={g.name}
                      className="grid items-center gap-2 text-sm sm:grid-cols-[10rem_1fr]"
                    >
                      <span className="text-muted-foreground">{g.name}</span>
                      <input type="hidden" name="group" value={g.name} />
                      <Input
                        name={`groupPurpose:${i}`}
                        defaultValue={data.groupPurpose[g.name] ?? ""}
                        maxLength={300}
                      />
                    </label>
                  ))}
                </div>
              )}
              <label className="flex flex-col gap-1 text-sm">
                {t("dist.eas.fields.benefits")}
                <Textarea name="benefits" rows={4} defaultValue={data.benefits} />
              </label>
            </Section>
            <Section title={t("dist.eas.suppliers")} hint={t("dist.eas.suppliersHint")}>
              {[0, 1, 2, 3].map((i) => {
                const s = data.suppliers[i];
                return (
                  <div key={i} className="grid gap-2 sm:grid-cols-[1fr_1.4fr_9rem]">
                    <Input
                      name={`supplier:${i}`}
                      defaultValue={s?.name ?? ""}
                      placeholder={t("dist.eas.supplierName")}
                      maxLength={120}
                    />
                    <Input
                      name={`legal:${i}`}
                      defaultValue={s?.legalName ?? ""}
                      placeholder={t("dist.eas.legalName")}
                      maxLength={200}
                    />
                    <Input
                      name={`total:${i}`}
                      inputMode="numeric"
                      defaultValue={s?.total ?? ""}
                      placeholder={t("dist.eas.total")}
                    />
                  </div>
                );
              })}
              <label className="flex flex-col gap-1 text-sm">
                {t("dist.eas.fields.recommended")}
                <Input name="recommended" defaultValue={data.recommended} maxLength={120} />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                {t("dist.eas.fields.recommendedReason")}
                <Textarea
                  name="recommendedReason"
                  rows={2}
                  defaultValue={data.recommendedReason}
                  placeholder="based on the most competitive pricing, strong service level and proven quality."
                />
              </label>
            </Section>
            <div>
              <Button type="submit">{t("dist.eas.save")}</Button>
            </div>
          </form>
        )}

        <Section title={t("dist.eas.preview")} hint={t("dist.eas.previewHint")}>
          <div className="flex flex-wrap gap-2 print:hidden">
            <CopyHtmlButton html={html} text={plain} />
            <Button asChild variant="outline" size="sm">
              <a href={`/api/distribution/campaigns/${id}/eas`}>
                <Download />
                Word
              </a>
            </Button>
            <Button asChild variant="outline" size="sm">
              <a href={`/api/distribution/campaigns/${id}/xlsx`}>
                <Download />
                {t("dist.campaign.listExcel")}
              </a>
            </Button>
          </div>
          {/* Our own markup, every value escaped in easHtml. */}
          <div
            className="overflow-x-auto rounded-lg border bg-white p-4 text-black"
            dangerouslySetInnerHTML={{ __html: html }}
          />
          <p className="text-muted-foreground flex items-center gap-1.5 text-xs print:hidden">
            <Printer className="size-3.5" />
            {t("dist.eas.printHint")}
          </p>
        </Section>
      </div>
    </div>
  );
}
