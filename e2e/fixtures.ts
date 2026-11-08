import { expect, test as base, type Page } from "@playwright/test";

import { ACCOUNTS, type Account } from "./env";

// `account`: who the project signs in as (set per project in playwright.config.ts).
export const test = base.extend<{ account: Account }>({
  account: [ACCOUNTS.desktop, { option: true }],
});

export { expect };

// A title no other test (or earlier run) has.
export function uniqueTitle(prefix: string) {
  return `${prefix} ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

// Fills the new-task form (already open) with a title and today as the due date and creates the
// task. Returns the new task's id (the form opens the task's card).
export async function submitNewTask(page: Page, title: string) {
  await page.getByLabel("Название", { exact: true }).fill(title);
  await page.getByRole("button", { name: "Сегодня", exact: true }).click();
  await page.getByRole("button", { name: "Создать", exact: true }).click();
  await expect(page).toHaveURL(/\/tasks\/(?!new$)[^/?]+$/);
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
  return new URL(page.url()).pathname.split("/").pop()!;
}

// A task of the signed-in account, due today, made through the form.
export async function createTask(page: Page, title: string) {
  await page.goto("/tasks/new");
  return submitNewTask(page, title);
}
