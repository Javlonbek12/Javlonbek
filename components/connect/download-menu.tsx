"use client";

import { FileSpreadsheet, FileText, Presentation } from "lucide-react";
import { useId, useState } from "react";

import { menuItem } from "@/components/content/more-menu";
import { useLocale, useT } from "@/components/locale-provider";
import { EXPORT_LOCALES, type ExportLocale } from "@/lib/i18n";

// The «Скачать» block of the Connect «⋯» menu: the language of the file — Russian, English or
// Korean, the interface language until another is chosen — and the two files of what is on the
// screen. The language goes to the download as `lang`.
export function ConnectDownloads({ xlsx, pptx }: { xlsx: string; pptx: string }) {
  const t = useT();
  const locale = useLocale();
  const [lang, setLang] = useState<ExportLocale>(locale);
  const id = useId();
  const withLang = (href: string) => `${href}${href.includes("?") ? "&" : "?"}lang=${lang}`;

  return (
    <div
      role="group"
      aria-labelledby={`${id}-title`}
      className="flex flex-col gap-1 not-first:mt-1 not-first:border-t not-first:pt-2"
    >
      <p id={`${id}-title`} className="text-muted-foreground px-3 pt-1 text-xs font-medium">
        {t("connect.download.title")}
      </p>
      <fieldset className="px-1 pb-1">
        <legend className="sr-only">{t("connect.download.language")}</legend>
        <div className="bg-secondary/70 flex gap-0.5 rounded-full p-1">
          {EXPORT_LOCALES.map((l) => (
            <label
              key={l}
              className="text-muted-foreground hover:text-foreground has-checked:bg-card has-checked:text-foreground has-focus-visible:ring-ring/50 flex-1 cursor-pointer rounded-full px-2 py-1 text-center whitespace-nowrap has-checked:font-medium has-checked:shadow-sm has-focus-visible:ring-[3px]"
            >
              <input
                type="radio"
                name={`${id}-lang`}
                value={l}
                checked={lang === l}
                onChange={() => setLang(l)}
                className="sr-only"
              />
              <span lang={l}>{t(`connect.download.languages.${l}`)}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <a href={withLang(xlsx)} download className={menuItem}>
        <FileSpreadsheet />
        {t("connect.download.xlsx")}
      </a>
      <a href={withLang(pptx)} download className={menuItem}>
        <Presentation />
        {t("connect.download.pptx")}
      </a>
      {/* The page itself on A4 sheets, through the browser's «Сохранить как PDF»: exactly what is
          on the screen (in the interface's language). The menu is closed first, so it is not on
          the first sheet. */}
      <button
        type="button"
        className={menuItem}
        onClick={(event) => {
          event.currentTarget.closest("details")?.removeAttribute("open");
          setTimeout(() => window.print(), 50);
        }}
      >
        <FileText />
        <span className="flex flex-col">
          {t("connect.download.pdf")}
          <span className="text-muted-foreground text-xs">{t("connect.download.pdfHint")}</span>
        </span>
      </button>
    </div>
  );
}
