import {
  BarChart3,
  Bell,
  CalendarDays,
  CircleCheck,
  Clock,
  FileText,
  Flame,
  LayoutGrid,
  ListTodo,
  MessageSquare,
  Scale,
  Sun,
  Trash2,
  UserCog,
  UserPlus,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";

const ICONS: Record<string, LucideIcon> = {
  test: Bell,
  invite_accepted: UserPlus,
  role_changed: UserCog,
  task_pending_approval: CircleCheck,
  task_assigned: ListTodo,
  task_status: ListTodo,
  task_comment: MessageSquare,
  digest: Sun,
  due_reminder: Clock,
  overdue: Flame,
  weekly_summary: BarChart3,
  meeting_invite: CalendarDays,
  meeting_reminder: CalendarDays,
  content_assigned: FileText,
  content_review: FileText,
  content_feedback: FileText,
  content_approved: FileText,
  content_legal: Scale,
  task_delete_request: Trash2,
  task_team: ListTodo,
  task_waiting: Clock,
  planogram: LayoutGrid,
};

// What the notification is about, at a glance. Red only for «просрочено» (decision 7).
export function NotificationIcon({ type }: { type: string }) {
  const Icon = ICONS[type] ?? Bell;
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-8 shrink-0 items-center justify-center rounded-full",
        type === "overdue"
          ? "bg-destructive/10 text-destructive"
          : "bg-muted text-muted-foreground",
      )}
    >
      <Icon className="size-4" />
    </span>
  );
}
