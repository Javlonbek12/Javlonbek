import type { TaskInput } from "@/modules/tasks/service";

export function taskInput(overrides: Partial<TaskInput> = {}): TaskInput {
  return {
    title: "Тестовая задача",
    description: null,
    isPersonal: false,
    assigneeId: null,
    startDate: null,
    dueDate: null,
    priority: "MEDIUM",
    project: null,
    planId: null,
    estimateHours: null,
    ...overrides,
  };
}
