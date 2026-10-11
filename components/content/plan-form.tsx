import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import type { ContentChannel } from "@/lib/generated/prisma/enums";
import { t } from "@/lib/i18n";
import { CHANNELS } from "@/modules/content/service";

import { BOT_COLOR } from "./bot-chip";

type Values = {
  title: string;
  brief: string | null;
  channels: ContentChannel[];
  publishDate: string;
  publishTime: string | null;
  authorId: string | null;
};

// Topic, date, bots and author of a plan item.
export function PlanForm({
  action,
  values,
  users,
  postId,
  submit,
  showAuthor = true,
}: {
  action: (form: FormData) => Promise<void>;
  values: Partial<Values>;
  users: { id: string; name: string }[];
  postId?: string;
  submit: string;
  // Employees add posts for themselves: no author to choose.
  showAuthor?: boolean;
}) {
  return (
    <form action={action} className="flex flex-col gap-3 text-sm">
      {postId && <input type="hidden" name="postId" value={postId} />}
      <label className="flex flex-col gap-1">
        {t("content.fields.title")}
        <Input name="title" required maxLength={200} defaultValue={values.title} />
      </label>
      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1">{t("content.fields.channels")}</legend>
        <div className="flex flex-wrap gap-2">
          {CHANNELS.map((channel) => (
            <label
              key={channel}
              className="has-[:checked]:border-primary has-[:checked]:bg-secondary flex items-center gap-2 rounded-full border px-3 py-1.5"
            >
              <input
                type="checkbox"
                name="channels"
                value={channel}
                defaultChecked={values.channels?.includes(channel)}
              />
              <span className="size-2 rounded-full" style={{ background: BOT_COLOR[channel] }} />
              {t(`content.channels.${channel}`)}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="flex flex-col gap-1">
          {t("content.fields.date")}
          <Input type="date" name="publishDate" required defaultValue={values.publishDate} />
        </label>
        <label className="flex flex-col gap-1">
          {t("content.fields.time")}
          <Input type="time" name="publishTime" defaultValue={values.publishTime ?? ""} />
        </label>
        {showAuthor && (
          <label className="flex flex-col gap-1">
            {t("content.fields.author")}
            <NativeSelect name="authorId" defaultValue={values.authorId ?? ""}>
              <option value="">{t("content.fields.noAuthor")}</option>
              {users.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.name}
                </option>
              ))}
            </NativeSelect>
          </label>
        )}
      </div>
      <label className="flex flex-col gap-1">
        {t("content.fields.brief")}
        <Textarea name="brief" rows={3} maxLength={4000} defaultValue={values.brief ?? ""} />
      </label>
      <div>
        <Button type="submit">{submit}</Button>
      </div>
    </form>
  );
}
