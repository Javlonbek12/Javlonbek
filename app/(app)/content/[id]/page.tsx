import { Ban, Download, Send } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { BotChip, ContentStatusBadge, LateBadge } from "@/components/content/bot-chip";
import { PlanForm } from "@/components/content/plan-form";
import { BRAND_COLOR, sectionMeta } from "@/components/content/analytics-charts";
import { FileUpload } from "@/components/content/file-upload";
import { MaterialsForm } from "@/components/content/materials-form";
import { PostPreview } from "@/components/content/post-preview";
import { DeleteButton } from "@/components/content/views";
import { CopyButton } from "@/components/copy-button";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { NativeSelect } from "@/components/ui/native-select";
import { PageHeader } from "@/components/ui/page-header";
import { Textarea } from "@/components/ui/textarea";
import { formatDayLong, toDateString } from "@/lib/dates";
import type { ContentStatus } from "@/lib/generated/prisma/enums";
import { t, type TranslationKey } from "@/lib/i18n";
import { formatDateTime } from "@/lib/time";
import { cn } from "@/lib/utils";
import { requireUser } from "@/modules/core/auth/current-user";
import { getSettings, getUserToday } from "@/modules/core/settings/service";
import { displayName, personName } from "@/modules/core/users/display-name";
import { MAX_FILE_MB, MAX_FILES_PER_LANG } from "@/modules/content/files";
import {
  changeSendsBackToReview,
  getPost,
  isLatePost,
  isOwnPost,
  listContentAuthors,
  nextChecks,
} from "@/modules/content/service";
import { listSections } from "@/modules/content/sections";
import { BRANDS } from "@/modules/content/tagging";

import {
  approveContentAction,
  cancelContentAction,
  restoreContentAction,
  commentContentAction,
  copyFilesAction,
  legalApproveAction,
  moveFileAction,
  removeFileAction,
  withdrawContentAction,
  deliverPostAction,
  feedbackContentAction,
  markSentAction,
  saveContentAction,
  setTagsAction,
  submitContentAction,
  updatePlanItemAction,
} from "../actions";

const IN_PROGRESS: ContentStatus[] = ["PLANNED", "DRAFT", "CHANGES", "REVIEW", "LEGAL_REVIEW"];

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
  const users = rights.editPlan && rights.planner ? await listContentAuthors(post.authorId) : [];
  const sections = await listSections();
  const meta = sectionMeta(sections);
  const language = lang === "uz" ? "uz" : "ru";
  const filesOf = (l: "RU" | "UZ") => post.files.filter((f) => f.lang === l);
  const shown = filesOf(language === "uz" ? "UZ" : "RU");
  const date = toDateString(post.publishDate);
  const late = isLatePost(post, await getUserToday(user.id));
  // «Что дальше» for the author of a post still in progress: who checks it, then the lawyer.
  const next =
    isOwnPost(user, post) && IN_PROGRESS.includes(post.status) ? await nextChecks(post) : null;
  const lawyerStep = rights.review ? (await nextChecks(post)).lawyerNext : false;
  // The latest remark of the reviewer, shown under the title while the post waits for changes.
  const remark =
    post.status === "CHANGES" ? post.comments.filter((c) => c.isFeedback).at(-1) : undefined;
  const hidden = <input type="hidden" name="postId" value={post.id} />;
  const back = `/content?month=${date.slice(0, 7)}`;
  // Said before saving: a change of text or files of an approved post sends it back to review.
  const recheck = changeSendsBackToReview(post.status) && (
    <p className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
      {t(post.status === "APPROVED" ? "content.recheck.approved" : "content.recheck.legal")}
    </p>
  );

  return (
    <div className="flex flex-col gap-4 [&>*]:min-w-0">
      <div className="flex flex-col gap-2">
        <Link href={back} className="text-muted-foreground text-sm hover:underline">
          ← {t("content.title")}
        </Link>
        <PageHeader
          title={post.title}
          actions={
            // Both rare and final actions together, each behind a confirmation.
            (rights.editPlan || rights.remove) && (
              <>
                {rights.editPlan && (
                  <ConfirmAction
                    label={t("content.actions.cancel")}
                    icon={<Ban className="size-4" />}
                    title={t("content.cancelConfirm.title")}
                    hint={t("content.cancelConfirm.hint")}
                    confirm={t("content.cancelConfirm.yes")}
                    action={cancelContentAction}
                    hidden={{ postId: post.id }}
                    align="right"
                  />
                )}
                {rights.remove && <DeleteButton postId={post.id} back={back} />}
              </>
            )
          }
        />
        {remark && (
          <div className="flex flex-col gap-1.5 rounded-xl border border-orange-500/40 bg-orange-500/10 p-3 text-sm">
            <span className="text-xs font-medium text-orange-800">
              {t("content.remark.title", { name: displayName(remark.author) })} ·{" "}
              {formatDateTime(remark.createdAt, timezone)}
            </span>
            <p className="whitespace-pre-wrap">{remark.body}</p>
            {rights.editContent && (
              <a href="#materials" className="text-primary w-fit text-sm font-medium underline">
                {t("content.remark.fix")}
              </a>
            )}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-1.5">
          <ContentStatusBadge status={post.status} />
          {late && <LateBadge />}
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
        <div className="flex flex-wrap items-center gap-1.5 text-sm">
          {post.topic ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium">
              <span
                className="size-2 rounded-full"
                style={{ background: meta[post.topic]?.color }}
              />
              {meta[post.topic]?.name ?? "—"}
            </span>
          ) : null}
          {post.brand && (
            <span className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium">
              <span className="size-2 rounded-sm" style={{ background: BRAND_COLOR[post.brand] }} />
              {t(`content.brands.${post.brand}`)}
            </span>
          )}
          <span className="text-muted-foreground text-xs">
            {post.tagPending && post.tagSource !== "manual"
              ? t("content.tags.pending")
              : post.tagSource === "ai"
                ? t("content.tags.byAi")
                : post.tagSource === "keywords"
                  ? t("content.tags.byKeywords")
                  : post.tagSource === "manual"
                    ? t("content.tags.manual")
                    : ""}
          </span>
          {(rights.planner || rights.editPlan) && (
            <details className="relative">
              <summary className="text-primary cursor-pointer list-none text-xs underline [&::-webkit-details-marker]:hidden">
                {t("content.tags.edit")}
              </summary>
              <form
                action={setTagsAction}
                className="bg-card shadow-card absolute left-0 z-30 mt-1 flex w-72 flex-col gap-2 rounded-xl border p-3 text-sm"
              >
                {hidden}
                <label className="flex flex-col gap-1">
                  {t("content.tags.topic")}
                  <NativeSelect name="topic" defaultValue={post.topic ?? undefined}>
                    {sections
                      .filter((s) => !s.archived || s.id === post.topic)
                      .map((s) => (
                        <option key={s.id} value={s.id}>
                          {meta[s.id]?.name ?? s.name}
                        </option>
                      ))}
                  </NativeSelect>
                </label>
                <label className="flex flex-col gap-1">
                  {t("content.tags.brand")}
                  <NativeSelect name="brand" defaultValue={post.brand ?? "GENERAL"}>
                    {BRANDS.map((brand) => (
                      <option key={brand} value={brand}>
                        {t(`content.brands.${brand}`)}
                      </option>
                    ))}
                  </NativeSelect>
                </label>
                <div>
                  <Button type="submit" size="sm">
                    {t("content.tags.save")}
                  </Button>
                </div>
              </form>
            </details>
          )}
        </div>
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
          {t(`content.errors.${error}` as TranslationKey, {
            mb: MAX_FILE_MB,
            max: MAX_FILES_PER_LANG,
          })}
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
            files={shown}
            text={language === "uz" ? post.textUz : post.textRu}
            time={post.publishTime}
          />
          <div className="flex flex-wrap gap-2">
            {post.textRu && <CopyButton value={post.textRu} label={t("content.actions.copyRu")} />}
            {post.textUz && <CopyButton value={post.textUz} label={t("content.actions.copyUz")} />}
          </div>
          {shown.length > 0 && (
            <ul className="flex flex-col gap-1 text-sm">
              {shown.map((f) => (
                <li key={f.id}>
                  <a
                    href={`/api/content/files/${f.id}?download=1`}
                    className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5"
                  >
                    <Download className="size-3.5" />
                    {f.name}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <div className="flex flex-col gap-4 [&>*]:min-w-0">
          {next && (
            <Card className="gap-2">
              <CardTitle>{t("content.next.title")}</CardTitle>
              <p className="text-sm">
                {t(
                  post.status === "LEGAL_REVIEW"
                    ? "content.next.legal"
                    : post.status === "REVIEW"
                      ? "content.next.review"
                      : "content.next.afterSubmit",
                  { names: next.names.join(", ") || "—" },
                )}
                {next.lawyerNext && ` ${t("content.next.thenLawyer")}`}
              </p>
              {rights.waitsForOthers && (
                <CardDescription>{t("content.next.notYours")}</CardDescription>
              )}
            </Card>
          )}

          {/* A reviewer returns the post with a remark instead of taking it back. */}
          {rights.withdraw && !rights.review && !rights.legal && (
            <Card className="gap-2">
              <CardDescription>{t("content.actions.withdrawHint")}</CardDescription>
              <form action={withdrawContentAction}>
                {hidden}
                <Button type="submit" variant="outline" size="sm">
                  {t("content.actions.withdraw")}
                </Button>
              </form>
            </Card>
          )}

          {(rights.review || rights.legal) && (
            <Card
              className={cn("gap-3", rights.legal ? "border-violet-500/40" : "border-amber-500/40")}
            >
              <CardTitle>
                {t(rights.legal ? "content.status.LEGAL_REVIEW" : "content.status.REVIEW")}
              </CardTitle>
              <form action={rights.legal ? legalApproveAction : approveContentAction}>
                {hidden}
                <Button type="submit">
                  {rights.legal
                    ? t("content.actions.legalApprove")
                    : lawyerStep
                      ? t("content.actions.approveToLegal")
                      : t("content.actions.approve")}
                </Button>
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

          {rights.restore && (
            <Card className="gap-2">
              <CardDescription>{t("content.restoreHint")}</CardDescription>
              <form action={restoreContentAction}>
                {hidden}
                <Button type="submit" variant="outline" size="sm">
                  {t("content.actions.restore")}
                </Button>
              </form>
            </Card>
          )}

          {rights.editContent && (
            <Card id="materials" className="scroll-mt-20 gap-3">
              <CardTitle>{t("content.materials")}</CardTitle>
              {recheck}
              <div id="files" className="flex scroll-mt-20 flex-col gap-3 text-sm">
                <span className="text-muted-foreground text-xs">
                  {t("content.fields.filesHint", { mb: MAX_FILE_MB, max: MAX_FILES_PER_LANG })}
                </span>
                {(["RU", "UZ"] as const).map((l) => {
                  const list = filesOf(l);
                  const other = l === "RU" ? "UZ" : "RU";
                  return (
                    <div key={l} className="flex flex-col gap-2 rounded-xl border p-3">
                      <span className="font-medium">
                        {t("content.fields.files")} {l}{" "}
                        <span className="text-muted-foreground font-normal">
                          {list.length}/{MAX_FILES_PER_LANG}
                        </span>
                      </span>
                      {list.length > 0 && (
                        <ul className="flex flex-col gap-1.5">
                          {list.map((f, i) => (
                            <li key={f.id} className="flex items-center gap-2">
                              {f.kind === "PHOTO" ? (
                                // eslint-disable-next-line @next/next/no-img-element -- private image from our API
                                <img
                                  src={`/api/content/files/${f.id}`}
                                  alt=""
                                  className="size-10 shrink-0 rounded-md object-cover"
                                />
                              ) : (
                                <span className="bg-muted text-muted-foreground flex size-10 shrink-0 items-center justify-center rounded-md text-[10px] font-semibold uppercase">
                                  {f.kind === "VIDEO"
                                    ? "▶"
                                    : (f.name.split(".").pop() ?? "").slice(0, 4)}
                                </span>
                              )}
                              <span className="flex min-w-0 flex-1 flex-col">
                                <span className="truncate">{f.name}</span>
                                <span className="text-muted-foreground text-xs">
                                  {t(`content.fileKinds.${f.kind}`)}
                                  {f.size > 0 &&
                                    ` · ${
                                      f.size < 1024 * 1024
                                        ? t("common.kb", { n: Math.ceil(f.size / 1024) })
                                        : t("common.mb", { n: (f.size / 1024 / 1024).toFixed(1) })
                                    }`}
                                </span>
                              </span>
                              {(["up", "down"] as const).map((direction) =>
                                (direction === "up" ? i > 0 : i < list.length - 1) ? (
                                  <form key={direction} action={moveFileAction}>
                                    {hidden}
                                    <input type="hidden" name="fileId" value={f.id} />
                                    <input type="hidden" name="direction" value={direction} />
                                    <Button
                                      type="submit"
                                      variant="ghost"
                                      size="sm"
                                      aria-label={t(`content.actions.${direction}`)}
                                    >
                                      {direction === "up" ? "↑" : "↓"}
                                    </Button>
                                  </form>
                                ) : null,
                              )}
                              <form action={removeFileAction}>
                                {hidden}
                                <input type="hidden" name="fileId" value={f.id} />
                                <Button
                                  type="submit"
                                  variant="ghost"
                                  size="sm"
                                  className="text-destructive"
                                  aria-label={t("content.actions.removeFile")}
                                >
                                  ✕
                                </Button>
                              </form>
                            </li>
                          ))}
                        </ul>
                      )}
                      <div className="flex flex-wrap items-start gap-2">
                        <FileUpload
                          postId={post.id}
                          lang={l}
                          label={t("content.actions.uploadFiles")}
                          progressLabel={t("content.actions.uploading")}
                          left={MAX_FILES_PER_LANG - list.length}
                        />
                        {filesOf(other).length > 0 && (
                          <form action={copyFilesAction}>
                            {hidden}
                            <input type="hidden" name="to" value={l} />
                            <Button type="submit" variant="ghost" size="sm">
                              {t("content.actions.copyFiles", { from: other })}
                            </Button>
                          </form>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
              <MaterialsForm
                postId={post.id}
                textRu={post.textRu}
                textUz={post.textUz}
                files={{ RU: filesOf("RU").length, UZ: filesOf("UZ").length }}
                save={saveContentAction}
                submit={submitContentAction}
                canSubmit={rights.submit}
              />
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
                    c.isFeedback ? "border border-orange-500/30 bg-orange-500/8" : "bg-muted/60",
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
              values={{
                title: post.title,
                brief: post.brief,
                channels: post.channels,
                publishDate: date,
                publishTime: post.publishTime,
                authorId: post.authorId,
              }}
              users={users.map((u) => ({ id: u.id, name: personName(u) }))}
              submit={t("content.actions.save")}
              showAuthor={rights.planner}
            />
          </div>
        </details>
      )}
    </div>
  );
}
