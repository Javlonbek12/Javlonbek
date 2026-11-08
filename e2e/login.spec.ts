import { createTask, expect, test, uniqueTitle } from "./fixtures";

test("a link to a task leads through the dev login back to the task", async ({ page, account }) => {
  const title = uniqueTitle("Тестовая задача по ссылке");
  const taskId = await createTask(page, title);
  // Signed out: no session cookie any more.
  await page.context().clearCookies();

  await page.goto(`/tasks/${taskId}`);
  await expect(page).toHaveURL(`/login?next=${encodeURIComponent(`/tasks/${taskId}`)}`);
  await expect(page.getByText("Вход для разработки")).toBeVisible();

  await page.getByLabel("Тестовый Telegram ID (число)").fill(account.telegramId);
  await page.getByLabel("Имя", { exact: true }).fill(account.firstName);
  await page.getByRole("button", { name: "Войти как тестовый пользователь" }).click();

  await expect(page).toHaveURL(`/tasks/${taskId}`);
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
});
