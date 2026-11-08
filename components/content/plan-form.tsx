"use client";

import Link from "next/link";
import { useActionState, useState } from "react";

import { useT } from "@/components/locale-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import type { ContentChannel } from "@/lib/generated/prisma/enums";
import type { TranslationKey } from "@/lib/i18n";

import { BOT_COLOR } from "./bot-chip";

export type PlanValues = {
  title: string;
  brief: string | null;
  channels: ContentChannel[];
  publishDate: string;
  publishTime: string | null;
  authorId: string | null;
};

// A refused save comes back with what was typed, so nothing is lost.
export type PlanFormState = {
  error: string | null;
  values: Partial<PlanValues> & { textRu?: string | null };
};

const CHANNELS = Object.keys(BOT_COLOR) as ContentChannel[];

// Topic, date, bots and author of a plan item. At least one bot is required: checked here, before
// sending, because a browser can't require "one of these checkboxes".
export function PlanForm({
  action,
  values,
  users,
  postId,
  submit,
  showAuthor = true,
  cancelHref,
  withText = false,
}: {
  action: (state: PlanFormState, form: FormData) => Promise<PlanFormState>;
  values: Partial<PlanValues> & { textRu?: string | null };
  users: { id: string; name: string }[];
  postId?: string;
  submit: string;
  // Employees add posts for themselves: no author to choose.
  showAuthor?: boolean;
  // A «Отмена» link back (the new post page).
  cancelHref?: string;
  // A new post: its Russian text can be typed right away, a short post is one step.
  withText?: boolean;
}) {
  const t = useT();
  const [state, dispatch, pending] = useActionState(action, { error: null, values });
  const current = state.values;
  const [channels, setChannels] = useState<ContentChannel[]>(current.channels ?? []);
  const [noBot, setNoBot] = useState(false);

  return (
    <form
      action={dispatch}
      onSubmit={(e) => {
        if (channels.length === 0) {
          e.preventDefault();
          setNoBot(true);
        }
      }}
      className="flex flex-col gap-3 text-sm"
    >
      {postId && <input type="hidden" name="postId" value={postId} />}
      {state.error && (
        <p role="alert" className="bg-destructive/10 text-destructive rounded-md p-3 text-sm">
          {t(`content.errors.${state.error}` as TranslationKey)}
        </p>
      )}
      <label className="flex flex-col gap-1">
        {t("content.fields.title")}
        <Input name="title" required maxLength={200} defaultValue={current.title} />
      </label>
      <fieldset className="flex flex-col gap-1.5" aria-invalid={noBot}>
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
                checked={channels.includes(channel)}
                onChange={(e) => {
                  setNoBot(false);
                  setChannels((list) =>
                    e.target.checked ? [...list, channel] : list.filter((c) => c !== channel),
                  );
                }}
              />
              <span className="size-2 rounded-full" style={{ background: BOT_COLOR[channel] }} />
              {t(`content.channels.${channel}`)}
            </label>
          ))}
        </div>
        {noBot && (
          <span role="alert" className="text-destructive text-xs">
            {t("content.errors.noChannel")}
          </span>
        )}
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="flex flex-col gap-1">
          {t("content.fields.date")}
          <Input type="date" name="publishDate" required defaultValue={current.publishDate} />
        </label>
        <label className="flex flex-col gap-1">
          {t("content.fields.time")}
          <Input type="time" name="publishTime" defaultValue={current.publishTime ?? ""} />
        </label>
        {showAuthor && (
          <label className="flex flex-col gap-1">
            {t("content.fields.author")}
            <NativeSelect name="authorId" defaultValue={current.authorId ?? ""}>
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
        <Textarea name="brief" rows={3} maxLength={4000} defaultValue={current.brief ?? ""} />
      </label>
      {withText && (
        <label className="flex flex-col gap-1">
          {t("content.newForm.textRu")}
          <Textarea name="textRu" rows={4} maxLength={4096} defaultValue={current.textRu ?? ""} />
        </label>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? "…" : submit}
        </Button>
        {cancelHref && (
          <Button asChild variant="ghost">
            <Link href={cancelHref}>{t("content.newForm.cancel")}</Link>
          </Button>
        )}
      </div>
    </form>
  );
}
