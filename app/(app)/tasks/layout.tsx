import { TaskTabs } from "@/components/tasks/task-tabs";

export default function TasksLayout({ children }: LayoutProps<"/tasks">) {
  return (
    <div className="flex flex-col gap-4">
      <TaskTabs />
      {children}
    </div>
  );
}
