import { db } from "@/lib/db";
import { logActivity } from "@/modules/core/activity/service";
import type { Actor } from "@/modules/core/permissions";

import { reserveLabel } from "./builder";
import type { Campaign } from "./campaign";
import { canManageDistribution, DistributionError } from "./service";

// The EAS approval document of a campaign, laid out like the company's EAS form: the budget block,
// the request, background and purpose, the POSM summary by group, the printers compared, the
// recommended one, the expected benefits, the final request and the attachments. What the
// campaign knows (quantities, amounts, the printer, files) is filled in; the rest is typed once —
// the budget fields of a new campaign start from the last one's.

type Viewer = Parameters<typeof canManageDistribution>[0];

export type EasSupplier = { name: string; legalName: string; total: number | null };

export type EasData = {
  budgetMonth: string;
  budgetCategory: string;
  categoryRemark: string;
  team: string;
  account: string;
  division: string;
  department: string;
  pic: string;
  month: string;
  expensesDetails: string;
  monthlyBudget: number | null;
  alreadySpent: number | null;
  title: string;
  intro: string;
  background: string;
  // One point per line.
  purpose: string;
  scope: string;
  coverage: string;
  // The purpose of each POSM group (by element name).
  groupPurpose: Record<string, string>;
  suppliers: EasSupplier[];
  recommended: string;
  recommendedReason: string;
  benefits: string;
};

const BUDGET_FIELDS = [
  "budgetCategory",
  "categoryRemark",
  "team",
  "account",
  "division",
  "department",
  "pic",
] as const;

const emptyEas = (): EasData => ({
  budgetMonth: "",
  budgetCategory: "Printing Materials",
  categoryRemark: "",
  team: "",
  account: "",
  division: "",
  department: "",
  pic: "",
  month: "",
  expensesDetails: "",
  monthlyBudget: null,
  alreadySpent: null,
  title: "",
  intro: "",
  background: "",
  purpose: "",
  scope: "manufacturing of POS materials; packaging services.",
  coverage: "",
  groupPurpose: {},
  suppliers: [],
  recommended: "",
  recommendedReason: "",
  benefits: "",
});

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

// The saved fields, or a first draft: the budget block from the last campaign's EAS, the rest from
// this campaign.
export async function easData(c: Campaign): Promise<EasData> {
  const saved = c.order.eas as Partial<EasData> | null;
  if (saved) return { ...emptyEas(), ...saved };
  const recent = await db.distOrder.findMany({
    where: { id: { not: c.order.id } },
    orderBy: { createdAt: "desc" },
    select: { eas: true },
    take: 20,
  });
  const last = recent.find((o) => o.eas !== null);
  const base = emptyEas();
  const previous = (last?.eas ?? {}) as Partial<EasData>;
  for (const key of BUDGET_FIELDS) if (previous[key]) base[key] = previous[key]!;
  if (previous.monthlyBudget != null) base.monthlyBudget = previous.monthlyBudget;
  const now = new Date();
  base.month = MONTHS[now.getUTCMonth()]!;
  base.budgetMonth = `${base.month} ${now.getUTCFullYear()}`;
  base.title = `POSM Production – ${c.order.name}`;
  base.expensesDetails = `Printing Materials (${c.order.name})`;
  base.background = c.order.description ?? "";
  const supplier = c.items.find((i) => i.supplier)?.supplier ?? "";
  if (supplier) {
    base.suppliers = [{ name: supplier, legalName: "", total: null }];
    base.recommended = supplier;
  }
  return base;
}

const text = (v: unknown, max = 4000) => (typeof v === "string" ? v.slice(0, max) : "");
const amount = (v: unknown) =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.round(v) : null;

export async function saveEas(actor: Actor & Viewer, id: string, input: EasData) {
  if (!canManageDistribution(actor)) throw new DistributionError("forbidden");
  const order = await db.distOrder.findUnique({ where: { id } });
  if (!order) throw new DistributionError("notFound");
  if (order.closed) throw new DistributionError("closed");
  const clean: EasData = {
    ...emptyEas(),
    ...Object.fromEntries(
      Object.entries(input).map(([k, v]) => [k, typeof v === "string" ? text(v) : v]),
    ),
    monthlyBudget: amount(input.monthlyBudget),
    alreadySpent: amount(input.alreadySpent),
    groupPurpose: Object.fromEntries(
      Object.entries(input.groupPurpose ?? {}).map(([k, v]) => [text(k, 120), text(v, 500)]),
    ),
    suppliers: (input.suppliers ?? [])
      .filter((s) => s.name.trim())
      .slice(0, 10)
      .map((s) => ({
        name: text(s.name, 120).trim(),
        legalName: text(s.legalName, 200).trim(),
        total: amount(s.total),
      })),
  };
  await db.distOrder.update({ where: { id }, data: { eas: clean } });
  await logActivity({
    actorId: actor.id,
    action: "distribution.eas",
    entityType: "DistOrder",
    entityId: id,
  });
}

// ——— The document ———

export type EasDoc = ReturnType<typeof buildEas>;

export function buildEas(c: Campaign, data: EasData) {
  const requested = Math.round(c.total);
  const groups = new Map<string, { qty: number; amount: number; types: Set<string> }>();
  for (const item of c.items) {
    const g = groups.get(item.category) ?? { qty: 0, amount: 0, types: new Set<string>() };
    g.qty += item.ordered;
    g.amount += (item.price ?? 0) * item.ordered;
    for (const t of item.types) g.types.add(t);
    groups.set(item.category, g);
  }
  const summary = [...groups].map(([name, g]) => ({
    group: g.types.size > 1 ? `${name} (${g.types.size} display types)` : name,
    purpose: data.groupPurpose[name] ?? "",
    qty: g.qty,
    amount: Math.round(g.amount),
  }));
  // Our printer's total is the campaign's own; the others are typed in.
  const suppliers = data.suppliers.map((s) => ({
    ...s,
    total: s.total ?? (s.name === data.recommended ? requested : null),
  }));
  const totals = suppliers.map((s) => s.total).filter((t): t is number => t !== null);
  const lowest = totals.length ? Math.min(...totals) : null;
  const comparison = suppliers.map((s) => ({
    name: s.name,
    total: s.total,
    diff: s.total === null || lowest === null ? null : s.total - lowest,
    pct: s.total === null || !lowest ? null : (s.total - lowest) / lowest,
  }));
  const chosen = suppliers.find((s) => s.name === data.recommended);
  const units = c.items.reduce((s, i) => s + i.orderedFor, 0);
  const pieces = c.items.reduce((s, i) => s + i.ordered, 0);
  const coverage =
    data.coverage ||
    `${units.toLocaleString("ru-RU")} equipment units, ${pieces.toLocaleString("ru-RU")} pcs including a ${reserveLabel(
      c.order as Parameters<typeof reserveLabel>[0],
    )} reserve.`;
  const recommendedName = chosen
    ? chosen.legalName
      ? `"${chosen.name}" (${chosen.legalName})`
      : `"${chosen.name}"`
    : "";
  return {
    title: data.title,
    budget: [
      ["Budget Month", data.budgetMonth],
      ["Budget Category", data.budgetCategory],
      ["Category Remark", data.categoryRemark],
      ["Team", data.team],
      ["Account to use", data.account],
      ["Division", data.division],
      ["Department", data.department],
      ["PIC", data.pic],
      ["Month", data.month],
      ["Expenses request details", data.expensesDetails],
      ["Monthly Budget", money(data.monthlyBudget)],
      ["Requested amount to spend", money(requested)],
      ["Already spent in this month", data.alreadySpent ? money(data.alreadySpent) : "-"],
      [
        "Remaining budget amount",
        data.monthlyBudget === null
          ? ""
          : money(data.monthlyBudget - (data.alreadySpent ?? 0) - requested),
      ],
    ] as [string, string][],
    intro:
      data.intro ||
      `I would like to request your approval to proceed with the procurement of POS materials (POSM) for ${c.order.name}.`,
    background: data.background,
    purpose: data.purpose
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean),
    scope: data.scope,
    coverage,
    summary,
    requested,
    comparison,
    recommended: recommendedName,
    recommendedReason: data.recommendedReason,
    benefits: data.benefits
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean),
    finalRequest: recommendedName
      ? `Approval is requested to appoint ${recommendedName} and proceed with the procurement of the specified POS materials for a total amount of ${money(requested)} UZS, including VAT, in accordance with the attached commercial quotation and POSM breakdown.`
      : `Approval is requested to proceed with the procurement of the specified POS materials for a total amount of ${money(requested)} UZS, including VAT.`,
    attachments: [
      `POSM list and pricing (${c.order.name})`,
      ...c.order.files
        .filter((f) => f.kind === "QUOTE")
        .map((f) => `Commercial Quotation – ${f.name}`),
    ],
  };
}

export const money = (n: number | null) =>
  n === null ? "" : Math.round(n).toLocaleString("ru-RU").replace(/ /g, " ");

const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!,
  );

// The document as HTML with inline styles: pasted into the EAS editor or opened in Word, it keeps
// its tables.
export function easHtml(doc: EasDoc): string {
  const th =
    'style="border:1px solid #bbb;padding:4px 8px;background:#4a4a4a;color:#fff;text-align:left"';
  const td = 'style="border:1px solid #bbb;padding:4px 8px"';
  const tdr = 'style="border:1px solid #bbb;padding:4px 8px;text-align:right"';
  const h = (title: string) =>
    `<h3 style="border-left:4px solid #f08c00;padding-left:8px;margin:18px 0 6px;color:#555">${esc(title)}</h3>`;
  const p = (s: string) =>
    s
      .split(/\n{2,}/)
      .map((para) => `<p>${esc(para).replace(/\n/g, "<br>")}</p>`)
      .join("");
  const list = (items: string[]) =>
    items.length
      ? `<ul style="list-style:disc;padding-left:22px;margin:4px 0">${items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>`
      : "";
  const table = `border-collapse:collapse;width:100%;font-size:13px`;
  return [
    `<div style="font-family:Arial,sans-serif;font-size:13px;line-height:1.45;color:#222">`,
    doc.title ? `<h2 style="font-size:16px">${esc(doc.title)}</h2>` : "",
    `<table style="${table}">${doc.budget
      .map(
        ([k, v]) =>
          `<tr><td style="border:1px solid #bbb;padding:4px 8px;background:#f1f1f1;width:38%">${esc(k)}</td><td ${td}>${esc(v)}</td></tr>`,
      )
      .join("")}</table>`,
    p(doc.intro),
    doc.background ? h("BACKGROUND") + p(doc.background) : "",
    doc.purpose.length ? h("PURPOSE") + list(doc.purpose) : "",
    h("REQUESTED DETAILS"),
    `<p><b>Scope of work:</b> ${esc(doc.scope)}</p>`,
    `<p><b>Coverage:</b> ${esc(doc.coverage)}</p>`,
    `<p><b>POSM summary:</b></p>`,
    `<table style="${table}"><tr><th ${th}>POSM group</th><th ${th}>Purpose</th><th ${th}>Qty (pcs)</th><th ${th}>Amount (UZS)</th></tr>${doc.summary
      .map(
        (r) =>
          `<tr><td ${td}>${esc(r.group)}</td><td ${td}>${esc(r.purpose)}</td><td ${tdr}>${money(r.qty)}</td><td ${tdr}>${money(r.amount)}</td></tr>`,
      )
      .join(
        "",
      )}<tr style="background:#fde8d4;font-weight:bold"><td ${td}>TOTAL</td><td ${td}></td><td ${td}></td><td ${tdr}>${money(doc.requested)}</td></tr></table>`,
    doc.comparison.length
      ? h("COMMERCIAL COMPARISON") +
        `<table style="${table}"><tr><th ${th}>Supplier</th><th ${th}>Total cost (UZS, incl. VAT)</th><th ${th}>Difference vs. lowest</th></tr>${doc.comparison
          .map(
            (r) =>
              `<tr><td ${td}>${esc(r.name)}</td><td ${tdr}>${money(r.total)}</td><td ${tdr}>${
                r.diff === null
                  ? ""
                  : r.diff === 0
                    ? "—"
                    : `+${money(r.diff)} (+${((r.pct ?? 0) * 100).toFixed(1)}%)`
              }</td></tr>`,
          )
          .join("")}</table>`
      : "",
    doc.recommended
      ? h("RECOMMENDED SUPPLIER") +
        p(
          `${doc.recommended} is recommended${doc.recommendedReason ? ` ${doc.recommendedReason}` : "."}`,
        )
      : "",
    `<p><b>Total amount: ${money(doc.requested)} UZS (incl. VAT)</b></p>`,
    doc.benefits.length ? h("EXPECTED BENEFITS") + list(doc.benefits) : "",
    h("FINAL REQUEST") + p(doc.finalRequest),
    h("ATTACHMENTS") +
      `<ol style="list-style:decimal;padding-left:22px;margin:4px 0">${doc.attachments.map((a) => `<li>${esc(a)}</li>`).join("")}</ol>`,
    `</div>`,
  ].join("");
}
