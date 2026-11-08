import { expect, submitNewTask, test, uniqueTitle } from "./fixtures";

test("a task due today, made from «Сегодня», shows in «Мой день»", async ({ page }) => {
  const title = uniqueTitle("Тестовая задача на сегодня");
  await page.goto("/");
  const myDay = page.getByRole("heading", { name: /^Мой день/ });
  await expect(myDay).toBeVisible();

  // On a phone the button is a bare «+» (its text is hidden), so it is found by where it leads.
  await page.getByRole("main").getByRole("link", { name: "Новая задача" }).click();
  await expect(page).toHaveURL("/tasks/new");
  await submitNewTask(page, title);

  await page.getByRole("link", { name: "Сегодня", exact: true }).click();
  await expect(page).toHaveURL("/");
  const section = page.locator("section").filter({ has: myDay });
  await expect(section.getByRole("link", { name: title })).toBeVisible();
});
