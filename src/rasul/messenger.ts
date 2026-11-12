/**
 * TelegramMessenger — Rasul adapter for Telegram
 *
 * Implements the full Rasul interface: outbound messaging, inbound
 * routing, and interactive question rendering.
 *
 * Inbound: Telegram messages/callbacks → normalized RisalaDakhila events.
 * Outbound: QanatRisala channels → TelegramClient calls + channel DB.
 *
 * Channel resolution:
 *   "dispatch"         → TelegramClient.sendToDispatch()
 *   "kimyawi"          → TelegramClient.arsalaRisala() (private chat)
 *   { murshid: id }    → lookup channels table, arsalaIlaMurshidTopic()
 *                         fallback: dispatch with [id] prefix
 */

import { logger } from "../logging/logger.ts";
import { TelegramClient, TOPIC_COLORS, type TelegramMessage, type TelegramCallbackQuery } from "./telegram.ts";
import {
  haddathaAwAdkhalaQanat,
  jalabaQanat,
  jalabaQanatsForSession,
  jalabJalsaByChannel,
} from "../../db/db.ts";
import type { Rasul, RisalaDakhila, QanatRisala } from "../types.ts";

export { jalabaQanat, jalabaQanatsForSession, jalabJalsaByChannel } from "../../db/db.ts";

export const MUQADDIM = "telegram";

export class TelegramMessenger implements Rasul {
  #telegram: TelegramClient;

  #channelCache: Map<string, string> = new Map();

  #sessionChannels: Map<string, Record<string, string>> = new Map();

  #mualij: ((risala: RisalaDakhila) => Promise<void>) | null = null;

  constructor(telegram: TelegramClient) {
    this.#telegram = telegram;
  }

  indaRisala(handler: (risala: RisalaDakhila) => Promise<void>): void {
    this.#mualij = handler;
  }

  async baddaa(): Promise<void> {
    if (!this.mumakkan()) return;

    this.#rabatMualijat();

    await this.#telegram.startPolling();
  }

  awqaf(): void {
    this.#telegram.stopPolling();
  }

  async tahaqqaq(): Promise<boolean> {
    if (!this.mumakkan()) return false;
    return await this.#telegram.tahaqqaqToken();
  }

  mumakkan(): boolean {
    return this.#telegram.mumakkan();
  }

  async send(channel: QanatRisala, text: string): Promise<boolean> {
    return this.#arsala(channel, text, undefined);
  }

  async arsalaMunassaq(channel: QanatRisala, text: string): Promise<boolean> {
    return this.#arsala(channel, text, "Markdown");
  }

  async #arsala(channel: QanatRisala, text: string, parseMode: "Markdown" | undefined): Promise<boolean> {
    if (!this.mumakkan()) return false;

    if (channel === "dispatch") {
      return (await this.#telegram.sendToDispatch(text, { parseMode })) !== null;
    }

    if (channel === "kimyawi") {
      return (await this.#telegram.arsalaRisala(text, { parseMode })) !== null;
    }

    const topicId = this.#resolveMurshidTopic(channel.murshid);
    const raqm = topicId !== null
      ? await this.#telegram.arsalaIlaMurshidTopic(topicId, text, { parseMode })
      : await this.#telegram.sendToDispatch(`[${channel.murshid}] ${text}`, { parseMode });
    return raqm !== null;
  }

  async khalaqaQanatMurshid(identifier: string, title: string): Promise<string | null> {
    if (!this.#telegram.isGroupMode()) {
      return null;
    }

    const topicName = `${identifier}: ${title}`.slice(0, 128);
    const topic = await this.#telegram.createForumTopic(topicName, {
      iconColor: TOPIC_COLORS.blue,
    });

    if (!topic) {
      await logger.haDHHir("messenger", `Failed to create Telegram topic for ${identifier}`);
      return null;
    }

    const channelId = String(topic.message_thread_id);

    haddathaAwAdkhalaQanat(identifier, MUQADDIM, channelId);

    this.#cacheChannel(identifier, MUQADDIM, channelId);

    await logger.akhbar("messenger", `Created Telegram topic for ${identifier}`, {
      topicId: topic.message_thread_id,
    });

    return channelId;
  }

  yamlikQanatMurshid(identifier: string): boolean {
    const cached = this.#sessionChannels.get(identifier);
    if (cached && cached[MUQADDIM]) return true;

    const dbChannel = jalabaQanat(identifier, MUQADDIM);
    if (dbChannel) {
      this.#cacheChannel(identifier, MUQADDIM, dbChannel);
      return true;
    }
    return false;
  }

  hammalQanawatLilJalsa(identifier: string): Record<string, string> {
    const channels = jalabaQanatsForSession(identifier);
    this.#sessionChannels.set(identifier, channels);
    for (const [provider, channelId] of Object.entries(channels)) {
      this.#channelCache.set(`${provider}:${channelId}`, identifier);
    }
    return channels;
  }

  hallJalsaBilQanat(provider: string, channelId: string): string | null {
    const cacheKey = `${provider}:${channelId}`;
    const cached = this.#channelCache.get(cacheKey);
    if (cached) return cached;

    const fromDb = jalabJalsaByChannel(provider, channelId);
    if (fromDb) {
      this.#channelCache.set(cacheKey, fromDb);
      return fromDb;
    }
    return null;
  }

  #rabatMualijat(): void {
    this.#telegram.onMessage(async (message) => {
      await this.iqraRisala(message);
    });

    this.#telegram.onCallback(async (query) => {
      await this.iqraIstijaba(query);
    });
  }

  async iqraRisala(message: TelegramMessage): Promise<void> {
      if (!message.text || !this.#mualij) return;

      const text = message.text.trim();
      const topicId = this.#telegram.jalabRisalaTopicId(message);
      const isGroupMessage = this.#telegram.isGroupMessage(message);
      const isPrivateMessage = this.#telegram.isPrivateMessage(message);
      const isDispatchTopic = this.#telegram.isDispatchTopic(message);

      await logger.akhbar("messenger", `Received: ${text.slice(0, 100)}`, {
        topicId,
        isGroupMessage,
        isPrivateMessage,
        isDispatchTopic,
      });

      if (isPrivateMessage) {
        await this.#mualij({ naw: "khass" });
        return;
      }

      if (!isGroupMessage) {
        await logger.haDHHir("messenger", "Message from unknown chat type");
        return;
      }

      if (isDispatchTopic) {
        await this.#mualij({ naw: "irsal", nass: text, huwiyyatRisala: message.message_id });
        return;
      }
      if (topicId && topicId !== 1) {
        const huwiyya = this.hallJalsaBilQanat(MUQADDIM, String(topicId));
        if (huwiyya) {
          await this.#mualij({ naw: "murshid", huwiyya, nass: text });
        } else {
          await this.#telegram.arsalaRisala(
            "This topic is not linked to an active murshid.",
            { topicId, chatId: this.#telegram.getGroupId() },
          );
        }
        return;
      }

      if (isGroupMessage) {
        await this.#telegram.arsalaRisala(
          "Use the **Dispatch** topic to name a waṣfa and light a murshid.",
          { topicId: 1, chatId: this.#telegram.getGroupId(), parseMode: "Markdown" },
        );
        return;
      }

      await logger.haDHHir("messenger", "Group message without topic ID");
  }

  async iqraIstijaba(query: TelegramCallbackQuery): Promise<void> {
    if (!this.#mualij) return;
      if (!query.data) {
        await this.#telegram.answerCallback(query.id, "Received!");
        return;
      }

      await logger.akhbar("messenger", `Callback: ${query.data}`);
      await this.#telegram.answerCallback(query.id, "Received!");
  }

  #resolveMurshidTopic(identifier: string): number | null {
    const cached = this.#sessionChannels.get(identifier);
    if (cached?.[MUQADDIM]) {
      return parseInt(cached[MUQADDIM], 10);
    }

    const dbChannel = jalabaQanat(identifier, MUQADDIM);
    if (dbChannel) {
      this.#cacheChannel(identifier, MUQADDIM, dbChannel);
      return parseInt(dbChannel, 10);
    }

    return null;
  }

  #cacheChannel(identifier: string, provider: string, channelId: string): void {
    const existing = this.#sessionChannels.get(identifier) ?? {};
    existing[provider] = channelId;
    this.#sessionChannels.set(identifier, existing);

    this.#channelCache.set(`${provider}:${channelId}`, identifier);
  }
}

export function anshaaTelegramRasul(telegram: TelegramClient): TelegramMessenger {
  return new TelegramMessenger(telegram);
}
