import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { TaskButton } from "@/modules/tasks/buttons";

// The status buttons of the task card (routing v2). A change that asks for a reason («Отклонить»,
// «На доработку», cancelling) opens a small form first; accepting a task whose blocking task was
// cancelled asks to tick that this is on purpose.
export function TaskActions({
  taskId,
  buttons,
  action,
  openBlockers,
  cancelledBlockers,
}: {
  taskId: string;
  buttons: TaskButton[];
  action: (formData: FormData) => Promise<void>;
  openBlockers: number;
  cancelledBlockers: number;
}) {
  const hidden = (button: TaskButton) => (
    <>
      <input type="hidden" name="taskId" value={taskId} />
      <input type="hidden" name="to" value={button.to} />
      {button.then && <input type="hidden" name="then" value={button.then} />}
    </>
  );
  return buttons.map((button) => {
    const blocked = button.to === "DONE" && openBlockers > 0;
    const despite = button.to === "DONE" && cancelledBlockers > 0;
    if (!button.reason && !despite)
      return (
        <form key={button.to + button.label} action={action}>
          {hidden(button)}
          <Button type="submit" size="sm" variant={button.variant} disabled={blocked}>
            {t(button.label)}
          </Button>
        </form>
      );
    return (
      <details key={button.to + button.label} className="group open:basis-full">
        <summary
          className={cn(
            "inline-flex h-8 cursor-pointer items-center rounded-md px-3 text-sm font-medium select-none",
            button.variant === "default"
              ? "bg-primary text-primary-foreground hover:bg-primary/90"
              : button.variant === "outline"
                ? "border-input hover:bg-accent border"
                : "hover:bg-accent",
            blocked && "pointer-events-none opacity-50",
          )}
        >
          {t(button.label)}
        </summary>
        <form action={action} className="mt-2 flex flex-col gap-2">
          {hidden(button)}
          {button.reason && (
            <Textarea
              name="reason"
              required={button.reason === "required"}
              maxLength={1000}
              placeholder={t(`tasks.reason.${button.reason}`)}
              aria-label={t(`tasks.reason.${button.reason}`)}
            />
          )}
          {despite && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="despiteCancelled" required className="size-4" />
              {t("tasks.reason.despiteCancelled")}
            </label>
          )}
          <Button type="submit" size="sm" className="self-start">
            {t("tasks.reason.confirm")}
          </Button>
        </form>
      </details>
    );
  });
}
