import { expect, test } from "./fixtures";

test("phone: the bottom bar and «Ещё» with every other section", async ({ page, isMobile }) => {
  test.skip(!isMobile, "The bottom bar is for phones only.");
  await page.goto("/");

  const bar = page.getByRole("navigation", { name: "Main mobile" });
  for (const name of ["Сегодня", "Задачи", "Встречи", "Планограммы"]) {
    await expect(bar.getByRole("link", { name, exact: true })).toBeVisible();
  }
  await bar.getByRole("button", { name: "Ещё" }).click();
  await expect(page.getByText("Все разделы")).toBeVisible();

  await page.getByRole("link", { name: "Проекты", exact: true }).click();
  await expect(page).toHaveURL("/projects");
  await expect(page.getByRole("heading", { level: 1, name: "Проекты" })).toBeVisible();
  await expect(page.getByText("Все разделы")).toBeHidden();
});
