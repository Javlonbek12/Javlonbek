import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { t } from "@/lib/i18n";

type Values = {
  name: string;
  team: string | null;
  description: string | null;
  leadId: string | null;
};

// Name, team, lead and description of a project (create and edit).
export function ProjectForm({
  action,
  values,
  users,
  canChangeLead,
  projectId,
  submit,
}: {
  action: (form: FormData) => Promise<void>;
  values?: Values;
  users: { id: string; name: string }[];
  canChangeLead: boolean;
  projectId?: string;
  submit: string;
}) {
  return (
    <form action={action} className="flex flex-col gap-3 text-sm">
      {projectId && <input type="hidden" name="projectId" value={projectId} />}
      <label className="flex flex-col gap-1">
        {t("projects.name")}
        <Input name="name" required maxLength={60} defaultValue={values?.name} />
      </label>
      <label className="flex flex-col gap-1">
        {t("projects.team")}
        <Input name="team" maxLength={120} defaultValue={values?.team ?? ""} />
      </label>
      {canChangeLead ? (
        <>
          <label className="flex flex-col gap-1">
            {t("projects.lead")}
            <NativeSelect name="leadId" defaultValue={values?.leadId ?? ""}>
              <option value="">{t("projects.noLead")}</option>
              {users.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.name}
                </option>
              ))}
            </NativeSelect>
          </label>
          {projectId && (
            <label className="text-muted-foreground flex items-center gap-2 text-xs">
              <input type="checkbox" name="moveTasks" defaultChecked />
              {t("projects.moveTasks")}
            </label>
          )}
        </>
      ) : (
        <input type="hidden" name="leadId" value={values?.leadId ?? ""} />
      )}
      <label className="flex flex-col gap-1">
        {t("projects.description")}
        <Textarea
          name="description"
          maxLength={2000}
          rows={3}
          defaultValue={values?.description ?? ""}
        />
      </label>
      <div>
        <Button type="submit">{submit}</Button>
      </div>
    </form>
  );
}
