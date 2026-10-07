import { beforeEach, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import { withAccess } from "@/modules/core/access/actor";
import { approvePost, ContentError, saveContent, savePlanItem } from "@/modules/content/service";
import { deliverToTelegram, handleSentButton, type Sender } from "@/modules/content/telegram";
import { createTestUser, resetDb } from "@/tests/helpers/db";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

function fakeSender() {
  const log: string[] = [];
  const sender: Sender = {
    message: async (_chat, text, buttons) => {
      log.push(`msg:${text.split("\n")[0]}${buttons?.length ? ` [${buttons.length} btn]` : ""}`);
      return true;
    },
    photo: async (_chat, _image, caption) => {
      log.push(`photo:${caption.slice(0, 20)}`);
      return true;
    },
  };
  return { log, sender };
}

describe("content plan to Telegram", () => {
  beforeEach(resetDb);

  async function approved(
    owner: Awaited<ReturnType<typeof withAccess>>,
    title: string,
    time: string | null,
    texts: { textRu: string; textUz: string },
    image: boolean,
  ) {
    const post = await savePlanItem(owner, null, {
      title,
      channels: ["PARTNER", "CONNECT"],
      publishDate: "2026-10-07",
      publishTime: time,
    });
    await saveContent(owner, post.id, texts, image ? new File([PNG], "v.png") : null);
    await approvePost(owner, post.id);
    return post;
  }

  it("sends today's approved posts in time order: header with buttons, RU, then UZ", async () => {
    const owner = await withAccess(await createTestUser("OWNER"));
    await approved(
      owner,
      "Тестовый вечерний",
      "18:00",
      { textRu: "Вечер RU", textUz: "Kech UZ" },
      false,
    );
    const long = "Д".repeat(1500);
    const morning = await approved(
      owner,
      "Тестовый утренний",
      "09:00",
      { textRu: long, textUz: "Ertalab UZ" },
      true,
    );
    // Not approved yet: not sent.
    await savePlanItem(owner, null, {
      title: "Тестовый план",
      channels: ["PARTNER"],
      publishDate: "2026-10-07",
    });

    const { log, sender } = fakeSender();
    expect(await deliverToTelegram(owner, { date: "2026-10-07" }, sender)).toBe(2);
    expect(log).toEqual([
      "msg:📌 1/2 · 09:00 · Тестовый утренний [2 btn]",
      // RU text is too long for a caption: picture first, then the text.
      "photo:",
      `msg:${long}`,
      "photo:Ertalab UZ",
      "msg:📌 2/2 · 18:00 · Тестовый вечерний [2 btn]",
      "msg:Вечер RU",
      "msg:Kech UZ",
    ]);

    // The button under the header marks the bot as sent.
    const header = await handleSentButton(owner, morning.id, "P");
    expect(header.buttons).toHaveLength(1);
    await handleSentButton(owner, morning.id, "C");
    expect((await db.contentPost.findUniqueOrThrow({ where: { id: morning.id } })).status).toBe(
      "SENT",
    );
  });

  it("needs a planner with the bot connected and something approved for the day", async () => {
    const owner = await withAccess(await createTestUser("OWNER", { botChatId: null }));
    const member = await withAccess(await createTestUser("MEMBER"));
    const { sender } = fakeSender();
    await expect(deliverToTelegram(owner, { date: "2026-10-07" }, sender)).rejects.toMatchObject({
      code: "noBot",
    });
    await expect(deliverToTelegram(member, { date: "2026-10-07" }, sender)).rejects.toBeInstanceOf(
      ContentError,
    );
    await db.user.update({ where: { id: owner.id }, data: { botChatId: 1n } });
    await expect(deliverToTelegram(owner, { date: "2026-10-07" }, sender)).rejects.toMatchObject({
      code: "nothingToday",
    });
  });
});
