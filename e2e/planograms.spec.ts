import { expect, test } from "./fixtures";

// The demo planograms come from `prisma db seed`.
test("a planogram from the list shows its picture; on a phone it fits the screen", async ({
  page,
  isMobile,
}) => {
  await page.goto("/planograms");
  await expect(page.getByRole("heading", { level: 1, name: "Планограммы" })).toBeVisible();
  await page.getByRole("link", { name: "Display L POSI" }).click();

  await expect(page.getByRole("heading", { name: "Display L POSI" })).toBeVisible();
  const picture = page.getByRole("main").getByRole("img");
  await expect(picture).toBeVisible();
  expect(await picture.evaluate((el) => el.tagName)).toBe("svg");
  if (!isMobile) return;

  // Wider than a phone: scrolls sideways until «Уместить на экран».
  const fit = page.getByRole("button", { name: "Уместить на экран" });
  await expect(fit).toHaveAttribute("aria-pressed", "false");
  await fit.click();
  const actual = page.getByRole("button", { name: "Обычный размер" });
  await expect(actual).toHaveAttribute("aria-pressed", "true");
  const width = (await picture.boundingBox())!.width;
  expect(width).toBeLessThanOrEqual(page.viewportSize()!.width);

  await actual.click();
  await expect(fit).toBeVisible();
});
