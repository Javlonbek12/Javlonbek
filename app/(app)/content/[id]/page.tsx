import { Download, Send } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { BotChip, ContentStatusBadge } from "@/components/content/bot-chip";
import { PlanForm } from "@/components/content/plan-form";
import { PostPreview } from "@/components/content/post-preview";
import { DeleteButton } from "@/components/content/views";
import { CopyButton } from "@/components/copy-button";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { formatDayLong, toDateString } from "@/lib/dates";
import { t, type TranslationKey } from "@/lib/i18n";
import { formatDateTime } from "@/lib/time";
import { cn } from "@/lib/utils";
import { requireUser } from "@/modules/core/auth/current-user";
import { getSettings } from "@/modules/core/settings/service";
import { displayName } from "@/modules/core/users/display-name";
import { getPost, listContentAuthors, MAX_IMAGE_MB } from "@/modules/content/service";

import {
  approveContentAction,
  cancelContentAction,
  commentContentAction,
  deliverPostAction,
  feedbackContentAction,
  markSentAction,
  saveContentAction,
  submitContentAction,
  updatePlanItemAction,
} from "../actions";

export default async function ContentPostPage({
  params,
  searchParams,
}: PageProps<"/content/[id]">) {
  const user = await requireUser();
  const { id } = await params;
  const { error, lang, delivered } = await searchParams;
  const found = await getPost(user, id);
  if (!found) notFound();
  const { post, rights } = found;
  const { timezone } = await getSettings(user.id);
  const users = rights.editPlan && rights.planner ? await listContentAuthors() : [];
  const language = lang === "uz" ? "uz" : "ru";
  const imageUrl = post.imagePath
    ? `/api/content/${post.id}/image?v=${post.updatedAt.getTime()}`
    : null;
  const date = toDateString(post.publishDate);
  const hidden = <input type="hidden" name="postId" value={post.id} />;

  return (
    <div className="flex flex-col gap-4 [&>*]:min-w-0">
      <div className="flex flex-col gap-2">
        <Link
          href={`/content?month=${date.slice(0, 7)}`}
          className="text-muted-foreground text-sm hover:underline"
        >
          ← {t("content.title")}
        </Link>
        <div className="flex items-start justify-between gap-2">
          <h1 className="text-[22px] font-medium md:text-2xl">{post.title}</h1>
          {rights.remove && (
            <DeleteButton postId={post.id} back={`/content?month=${date.slice(0, 7)}`} />
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <ContentStatusBadge status={post.status} />
          <span className="text-muted-foreground text-sm">
            {formatDayLong(date)}
            {post.publishTime && `, ${post.publishTime}`}
          </span>
          {post.channels.map((c) => (
            <BotChip key={c} channel={c} sent={post.sentChannels.includes(c)} />
          ))}
        </div>
        <p className="text-muted-foreground text-sm">
          {t("content.fields.author")}:{" "}
          {post.author ? displayName(post.author) : t("content.fields.noAuthor")}
          {" · "}
          {t("content.fields.createdBy")}: {displayName(post.createdBy)}
        </p>
        {post.brief && (
          <p className="bg-secondary/60 rounded-xl px-3 py-2 text-sm whitespace-pre-wrap">
            {post.brief}
          </p>
        )}
      </div>

      {typeof delivered === "string" && (
        <p className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm">
          {t("content.telegram.done", { count: delivered })}
        </p>
      )}
      {typeof error === "string" && (
        <p role="alert" className="bg-destructive/10 text-destructive rounded-md p-3 text-sm">
          {t(`content.errors.${error}` as TranslationKey, { mb: MAX_IMAGE_MB })}
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] [&>*]:min-w-0">
        <Card className="gap-3">
          <div className="flex items-center justify-between gap-2">
            <CardTitle>{t("content.preview.title")}</CardTitle>
            <div className="bg-secondary/70 inline-flex rounded-full p-1 text-xs">
              {(["ru", "uz"] as const).map((l) => (
                <Link
                  key={l}
                  href={`/content/${post.id}${l === "uz" ? "?lang=uz" : ""}`}
                  className={cn(
                    "rounded-full px-3 py-1 font-medium",
                    language === l ? "bg-card shadow-sm" : "text-muted-foreground",
                  )}
                >
                  {l.toUpperCase()}
                </Link>
              ))}
            </div>
          </div>
          <PostPreview
            imageUrl={imageUrl}
            text={language === "uz" ? post.textUz : post.textRu}
            time={post.publishTime}
          />
          <div className="flex flex-wrap gap-2">
            {post.textRu && <CopyButton value={post.textRu} label={t("content.actions.copyRu")} />}
            {post.textUz && <CopyButton value={post.textUz} label={t("content.actions.copyUz")} />}
            {imageUrl && (
              <Button asChild variant="outline" size="sm">
                <a href={`/api/content/${post.id}/image?download=1`}>
                  <Download />
                  {t("content.actions.download")}
                </a>
              </Button>
            )}
          </div>
        </Card>

        <div className="flex flex-col gap-4 [&>*]:min-w-0">
          {(rights.review || (rights.planner && ["DRAFT", "CHANGES"].includes(post.status))) && (
            <Card className="gap-3 border-amber-500/40">
              <CardTitle>{t("content.status.REVIEW")}</CardTitle>
              <form action={approveContentAction}>
                {hidden}
                <Button type="submit">{t("content.actions.approve")}</Button>
              </form>
              <form action={feedbackContentAction} className="flex flex-col gap-2">
                {hidden}
                <Textarea
                  name="feedback"
                  required
                  rows={3}
                  maxLength={4000}
                  placeholder={t("content.actions.feedbackPlaceholder")}
                />
                <div>
                  <Button type="submit" variant="outline">
                    {t("content.actions.feedback")}
                  </Button>
                </div>
              </form>
            </Card>
          )}

          {(rights.send || post.status === "SENT") && (
            <Card className="gap-3 border-emerald-500/40">
              <CardTitle>{t("content.sending")}</CardTitle>
              <CardDescription>{t("content.sendingHint")}</CardDescription>
              {rights.planner && (
                <form action={deliverPostAction}>
                  {hidden}
                  <Button
                    type="submit"
                    variant="outline"
                    size="sm"
                    title={t("content.telegram.hint")}
                  >
                    <Send />
                    {t("content.telegram.one")}
                  </Button>
                </form>
              )}
              <ul className="flex flex-col gap-2">
                {post.channels.map((c) => {
                  const sent = post.sentChannels.includes(c);
                  return (
                    <li key={c} className="flex items-center justify-between gap-2">
                      <BotChip channel={c} />
                      {sent ? (
                        <span className="text-sm font-medium text-emerald-700">
                          ✓ {t("content.sent")}
                        </span>
                      ) : rights.send ? (
                        <form action={markSentAction}>
                          {hidden}
                          <input type="hidden" name="channel" value={c} />
                          <Button type="submit" size="sm">
                            {t("content.actions.markSent", { bot: t(`content.channels.${c}`) })}
                          </Button>
                        </form>
                      ) : (
                        <span className="text-muted-foreground text-sm">
                          {t("content.notSent")}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </Card>
          )}

          {rights.editContent && (
            <Card className="gap-3">
              <CardTitle>{t("content.materials")}</CardTitle>
              <form action={saveContentAction} className="flex flex-col gap-3 text-sm">
                {hidden}
                <label className="flex flex-col gap-1">
                  {t("content.fields.image")}
                  <Input
                    type="file"
                    name="image"
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    className="h-auto py-1.5"
                  />
                  <span className="text-muted-foreground text-xs">
                    {t("content.fields.imageHint", { mb: MAX_IMAGE_MB })}
                  </span>
                </label>
                <label className="flex flex-col gap-1">
                  {t("content.fields.textRu")}
                  <Textarea
                    name="textRu"
                    rows={6}
                    maxLength={4096}
                    defaultValue={post.textRu ?? ""}
                  />
                </label>
                <label className="flex flex-col gap-1">
                  {t("content.fields.textUz")}
                  <Textarea
                    name="textUz"
                    rows={6}
                    maxLength={4096}
                    defaultValue={post.textUz ?? ""}
                  />
                </label>
                <div>
                  <Button type="submit" variant="outline">
                    {t("content.actions.upload")}
                  </Button>
                </div>
              </form>
              {rights.submit && (
                <form action={submitContentAction} className="border-t pt-3">
                  {hidden}
                  <Button type="submit">{t("content.actions.submit")}</Button>
                </form>
              )}
            </Card>
          )}

          <Card className="gap-3">
            <CardTitle>{t("content.comments.title")}</CardTitle>
            {post.comments.length === 0 && (
              <p className="text-muted-foreground text-sm">{t("content.comments.none")}</p>
            )}
            <ul className="flex flex-col gap-2">
              {post.comments.map((c) => (
                <li
                  key={c.id}
                  className={cn(
                    "rounded-xl px-3 py-2 text-sm",
                    c.isFeedback ? "bg-destructive/8 border-destructive/30 border" : "bg-muted/60",
                  )}
                >
                  <span className="text-muted-foreground text-xs">
                    {displayName(c.author)} · {formatDateTime(c.createdAt, timezone)}
                    {c.isFeedback && ` · ${t("content.comments.feedback")}`}
                  </span>
                  <p className="whitespace-pre-wrap">{c.body}</p>
                </li>
              ))}
            </ul>
            <form action={commentContentAction} className="flex flex-col gap-2">
              {hidden}
              <Textarea
                name="body"
                required
                rows={2}
                maxLength={4000}
                placeholder={t("content.comments.placeholder")}
              />
              <div>
                <Button type="submit" variant="outline" size="sm">
                  {t("content.comments.add")}
                </Button>
              </div>
            </form>
          </Card>
        </div>
      </div>

      {rights.editPlan && (
        <details className="bg-card shadow-card rounded-2xl border p-4">
          <summary className="cursor-pointer font-medium">{t("content.edit")}</summary>
          <div className="flex flex-col gap-3 pt-3">
            <PlanForm
              action={updatePlanItemAction}
              postId={post.id}
              values={{ ...post, publishDate: date }}
              users={users.map((u) => ({ id: u.id, name: displayName(u) }))}
              submit={t("content.actions.save")}
              showAuthor={rights.planner}
            />
            <form action={cancelContentAction} className="border-t pt-3">
              {hidden}
              <Button type="submit" variant="ghost" className="text-destructive">
                {t("content.actions.cancel")}
              </Button>
            </form>
          </div>
        </details>
      )}
    </div>
  );
}
