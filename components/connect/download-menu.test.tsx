import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { LocaleProvider } from "@/components/locale-provider";
import type { Locale } from "@/lib/i18n";

import { ConnectDownloads } from "./download-menu";

const XLSX = "/api/connect/xlsx?view=exec&preset=week";
const PPTX = "/api/connect/pptx?view=exec&preset=week";

const renderIn = (locale: Locale) =>
  render(
    <LocaleProvider locale={locale}>
      <ConnectDownloads xlsx={XLSX} pptx={PPTX} />
    </LocaleProvider>,
  );

describe("ConnectDownloads", () => {
  it("offers the three languages, the interface one chosen, and downloads in it", () => {
    renderIn("ru");
    expect(screen.getByRole("group", { name: "Скачать" })).toBeInTheDocument();
    const choice = screen.getByRole("group", { name: "Язык файла" });
    expect(choice).toBeInTheDocument();
    expect(screen.getAllByRole("radio").map((r) => r.closest("label")?.textContent)).toEqual([
      "Русский",
      "English",
      "한국어",
    ]);
    expect(screen.getByRole("radio", { name: "Русский" })).toBeChecked();
    expect(screen.getByRole("link", { name: "Excel" })).toHaveAttribute("href", `${XLSX}&lang=ru`);
    expect(screen.getByRole("link", { name: "PowerPoint" })).toHaveAttribute(
      "href",
      `${PPTX}&lang=ru`,
    );

    fireEvent.click(screen.getByRole("radio", { name: "한국어" }));
    expect(screen.getByRole("radio", { name: "한국어" })).toBeChecked();
    expect(screen.getByRole("link", { name: "Excel" })).toHaveAttribute("href", `${XLSX}&lang=ko`);
    expect(screen.getByRole("link", { name: "PowerPoint" })).toHaveAttribute(
      "href",
      `${PPTX}&lang=ko`,
    );
  });

  it("starts from English for an English interface", () => {
    renderIn("en");
    expect(screen.getByRole("group", { name: "Download" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "English" })).toBeChecked();
    expect(screen.getByRole("link", { name: "Excel" })).toHaveAttribute("href", `${XLSX}&lang=en`);
  });
});
