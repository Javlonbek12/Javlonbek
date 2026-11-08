import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LocaleProvider } from "@/components/locale-provider";

import { DocumentTitle } from "./document-title";

vi.mock("next/navigation", () => ({ usePathname: () => "/team" }));

const native = Object.getOwnPropertyDescriptor(Document.prototype, "title")!;

// Counts writes to document.title; past a few it throws, so a write loop ends instead of hanging.
function countTitleWrites() {
  let writes = 0;
  Object.defineProperty(document, "title", {
    configurable: true,
    get: () => native.get!.call(document),
    set: (value: string) => {
      if (++writes > 20) throw new Error("document.title is written in a loop");
      native.set!.call(document, value);
    },
  });
  return () => writes;
}

afterEach(() => {
  delete (document as { title?: string }).title;
});

describe("DocumentTitle", () => {
  it("names the tab after the section and leaves it alone afterwards", async () => {
    document.title = "Assistant";
    const writes = countTitleWrites();
    render(
      <LocaleProvider locale="ru">
        <DocumentTitle />
      </LocaleProvider>,
    );
    expect(document.title).toBe("Команда — Assistant");
    // Next.js writes the page's default <title> as the page streams in: the tab is named again,
    // once — the observer must not react to its own write.
    document.title = "Assistant";
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(document.title).toBe("Команда — Assistant");
    expect(writes()).toBe(3);
  });

  it("keeps a page's own title", async () => {
    document.title = "Отчёт за ноябрь";
    const writes = countTitleWrites();
    render(
      <LocaleProvider locale="ru">
        <DocumentTitle />
      </LocaleProvider>,
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(document.title).toBe("Отчёт за ноябрь");
    expect(writes()).toBe(0);
  });
});
