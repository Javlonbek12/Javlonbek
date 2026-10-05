// Test data for tasks on a real server.
//   add    — test employees and ~20 tasks around today (project "Тестовые данные")
//   remove — delete all of it
// On the server: GitHub → Actions → Server → demo-add / demo-remove.
import "dotenv/config";

import { db } from "@/lib/db";
import { addDemoData, removeDemoData } from "@/modules/tasks/demo";

async function main() {
  const command = process.argv[2];
  if (command === "add") {
    const result = await addDemoData();
    console.log(
      result.tasks
        ? `Test data added: ${result.tasks} tasks, ${result.people} test employees.`
        : "Test data is already there.",
    );
  } else if (command === "remove") {
    const result = await removeDemoData();
    console.log(`Test data removed: ${result.tasks} tasks, ${result.people} test employees.`);
  } else {
    console.log("Usage: demo-data.ts add | remove");
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
