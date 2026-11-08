import { createTask, expect, test, uniqueTitle } from "./fixtures";

test("the timer started in a task shows in the header and stops from there", async ({ page }) => {
  const title = uniqueTitle("Тестовая задача с таймером");
  await createTask(page, title);

  await page.getByRole("button", { name: "Начать", exact: true }).click();
  await expect(page.getByRole("button", { name: /^Остановить/ })).toBeVisible();

  // The red pill in the header of another page: the task's title and «Стоп».
  await page.goto("/tasks");
  const pill = page.getByTitle("Открыть задачу", { exact: true }).filter({ visible: true });
  await expect(pill).toContainText(title);
  await page.getByRole("button", { name: "Стоп", exact: true }).click();
  await expect(pill).toHaveCount(0);
  await expect(page).toHaveURL("/tasks");
});

test("the round button closes a task and «Вернуть» brings it back", async ({ page }) => {
  const title = uniqueTitle("Тестовая задача для закрытия");
  await createTask(page, title);

  await page.goto("/tasks");
  const row = page.getByRole("listitem").filter({ hasText: title });
  await row.getByRole("button", { name: "Отметить выполненной" }).click();

  const done = page.getByRole("status").filter({ hasText: title });
  await expect(done).toContainText("выполнена");
  // Closed tasks leave the list of active ones.
  await expect(row).toHaveCount(0);

  await done.getByRole("button", { name: "Вернуть" }).click();
  await expect(done).toHaveCount(0);
  await expect(row.getByRole("button", { name: "Отметить выполненной" })).toBeVisible();
});
