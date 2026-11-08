import { describe, expect, it } from "vitest";

import { formatNumber, formatPercent, plural, tn } from "./format";

// Russian separates thousands with a no-break space.
const nbsp = (text: string) => text.replace(/[  ]/g, " ");

describe("formatNumber / formatPercent", () => {
  it("uses a decimal comma in Russian and a point in English", () => {
    expect(formatNumber(7.25)).toBe("7,3");
    expect(formatNumber(7.25, 2)).toBe("7,25");
    expect(formatNumber(7, 1)).toBe("7");
    expect(nbsp(formatNumber(12500))).toBe("12 500");
    expect(formatNumber(7.25, 1, "en")).toBe("7.3");
    expect(formatNumber(12500, 0, "en")).toBe("12,500");
  });

  it("formats shares as percent", () => {
    expect(nbsp(formatPercent(0.173))).toBe("17 %");
    expect(nbsp(formatPercent(0.1734, 1))).toBe("17,3 %");
    expect(formatPercent(0.173, 0, "en")).toBe("17%");
  });
});

describe("plural", () => {
  const requests = "{n} заявка|{n} заявки|{n} заявок";

  it("agrees Russian words with the number", () => {
    expect(plural(1, requests)).toBe("1 заявка");
    expect(plural(3, requests)).toBe("3 заявки");
    expect(plural(5, requests)).toBe("5 заявок");
    expect(plural(11, requests)).toBe("11 заявок");
    expect(plural(21, requests)).toBe("21 заявка");
    expect(plural(1.5, requests)).toBe("1,5 заявки");
  });

  it("uses one|other in English", () => {
    expect(plural(1, "{n} request|{n} requests", "en")).toBe("1 request");
    expect(plural(2, "{n} request|{n} requests", "en")).toBe("2 requests");
  });

  it("takes the forms from the dictionary", () => {
    // Any dictionary string works; one without "|" has a single form.
    expect(tn("app.name", 3)).toBe("Assistant");
  });
});
