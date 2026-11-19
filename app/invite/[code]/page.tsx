import { redirect } from "next/navigation";

import { DevLoginForm } from "@/components/dev-login-form";
import { AuthShell } from "@/components/auth-shell";
import { LoginError } from "@/components/login-error";
import { TelegramLoginButton } from "@/components/telegram-login-button";
import { Card } from "@/components/ui/card";
import { db } from "@/lib/db";
import { getEnv, isDevLoginEnabled } from "@/lib/env";
import { t } from "@/lib/i18n";
import { formatDate } from "@/lib/time";
import { getCurrentUser, getViewerLocale } from "@/modules/core/auth/current-user";
import { findInviteByCode, getInviteStatus } from "@/modules/core/invites/service";
import { displayName } from "@/modules/core/users/display-name";

export async function generateMetadata() {
  await getViewerLocale();
  return { title: t("invite.tabTitle") };
}

// Who sent the invitation and the org-chart place it is for: the newcomer sees who invites them
// and where they will sit before signing in.
async function inviteDetails(invite: { createdById: string; orgNodeId: string | null }) {
  const [inviter, node] = await Promise.all([
    db.user.findUnique({
      where: { id: invite.createdById },
      select: { firstName: true, lastName: true, photoUrl: true },
    }),
    invite.orgNodeId
      ? db.orgNode.findUnique({
          where: { id: invite.orgNodeId },
          select: { title: true, label: true, parent: { select: { kind: true, name: true } } },
        })
      : null,
  ]);
  // "Мерчендайзер (Самарканд)": the job title, with the unit it sits in.
  const unit = node?.parent?.kind === "UNIT" ? node.parent.name : node?.label;
  const place = node?.title ? (unit ? `${node.title} (${unit})` : node.title) : null;
  return { inviter, place };
}

export default async function InvitePage({ params, searchParams }: PageProps<"/invite/[code]">) {
  if (await getCurrentUser()) redirect("/");
  await getViewerLocale();
  const { code } = await params;
  const { error } = await searchParams;
  const { TELEGRAM_BOT_USERNAME, TELEGRAM_BOT_TOKEN, APP_URL, DEFAULT_TIMEZONE } = getEnv();

  const invite = await findInviteByCode(code);
  const status = getInviteStatus(invite);
  const telegram = Boolean(TELEGRAM_BOT_USERNAME && TELEGRAM_BOT_TOKEN);

  if (!invite || status !== "valid") {
    return (
      <AuthShell>
        <Card>
          <h2 className="font-display text-xl font-medium">{t("invite.title")}</h2>
          <LoginError error={status} />
        </Card>
      </AuthShell>
    );
  }

  const { inviter, place } = await inviteDetails(invite);
  const inviterName = inviter ? displayName(inviter) : t("app.name");
  const bot = `@${TELEGRAM_BOT_USERNAME}`;
  // The bot's name inside the second step is a link to it.
  const [beforeBot, afterBot] = t("invite.steps.bot").split("{bot}");
  const steps = [
    t("invite.steps.login"),
    <>
      {beforeBot}
      {telegram && (
        // With the code: Start in the bot also lets the newcomer in when the sign-in button fails.
        <a
          className="text-primary underline"
          href={`https://t.me/${TELEGRAM_BOT_USERNAME}?start=${encodeURIComponent(code)}`}
        >
          {bot}
        </a>
      )}
      {afterBot}
    </>,
    t("invite.steps.today"),
  ];

  return (
    <AuthShell>
      <Card className="gap-5">
        <div className="flex items-center gap-3.5">
          {inviter?.photoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- Telegram profile picture
            <img
              src={inviter.photoUrl}
              alt=""
              className="size-12 shrink-0 rounded-full object-cover"
            />
          ) : (
            <span
              aria-hidden
              className="flex size-12 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[var(--series-5)] to-[var(--series-7)] text-lg font-semibold text-white"
            >
              {inviterName.charAt(0).toUpperCase()}
            </span>
          )}
          <div className="flex min-w-0 flex-col gap-0.5">
            <h2 className="font-display text-xl leading-tight font-semibold">
              {t("invite.invitedBy", { name: inviterName })}
            </h2>
            <p className="text-muted-foreground text-sm">
              {[
                t("invite.role", { role: t(`roles.${invite.role}`) }),
                place && t("invite.place", { place }),
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>
        </div>
        <ol className="flex flex-col gap-2.5">
          {steps.map((step, index) => (
            <li key={index} className="flex gap-3 text-[15px] leading-snug">
              <span className="bg-secondary text-secondary-foreground flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold">
                {index + 1}
              </span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
        <LoginError error={typeof error === "string" ? error : undefined} />
        {telegram ? (
          <TelegramLoginButton
            botUsername={TELEGRAM_BOT_USERNAME!}
            authUrl={`${APP_URL}/api/auth/telegram?invite=${encodeURIComponent(code)}`}
          />
        ) : (
          <p className="text-muted-foreground text-sm">{t("login.widgetNotConfigured")}</p>
        )}
        <p className="text-muted-foreground text-sm">
          {telegram && (
            <>
              {t("invite.orBot")}{" "}
              <a
                className="text-primary underline"
                href={`https://t.me/${TELEGRAM_BOT_USERNAME}?start=${encodeURIComponent(code)}`}
              >
                {bot}
              </a>
              {" · "}
            </>
          )}
          {t("invite.validUntil", { date: formatDate(invite.expiresAt, DEFAULT_TIMEZONE) })}
        </p>
      </Card>
      {isDevLoginEnabled() && <DevLoginForm inviteCode={code} />}
    </AuthShell>
  );
}
