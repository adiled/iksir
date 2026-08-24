/**
 * TelegramMessenger — Rasul adapter for Telegram
 *
 * Implements the full Rasul interface: outbound messaging, inbound
 * routing, and interactive question rendering.
 *
 * Inbound: Telegram messages/callbacks → normalized RisalaDakhila events.
 * Outbound: QanatRisala channels → TelegramClient calls + channel DB.
 * Interactive: KhiyarTafauli[] → Telegram inline keyboards.
 *
 * Channel resolution:
 *   "dispatch"         → TelegramClient.sendToDispatch()
 *   "kimyawi"          → TelegramClient.arsalaRisala() (private chat)
 *   { murshid: id }    → lookup channels table, arsalaIlaMurshidTopic()
 *                         fallback: dispatch with [id] prefix
 */

import { logger } from "../logging/logger.ts";
import { TelegramClient, TOPIC_COLORS } from "./telegram.ts";
import {
  haddathaAwAdkhalaQanat,
  jalabaQanat,
  jalabaQanatsForSession,
  jalabJalsaByChannel,
} from "../../db/db.ts";
import type { Rasul, RisalaDakhila, QanatRisala, KhiyarTafauli } from "../types.ts";

/** Re-export for convenience */
export { jalabaQanat, jalabaQanatsForSession, jalabJalsaByChannel } from "../../db/db.ts";

/** The provider name used in the qanawat (channels) table */
export const MUQADDIM = "telegram";


export class TelegramMessenger implements Rasul {
  #telegram: TelegramClient;

  /** In-memory cache: provider:channelId → sessionIdentifier (reverse lookup) */
  #channelCache: Map<string, string> = new Map();

  /** In-memory cache: sessionIdentifier → Record<provider, channelId> */
  #sessionChannels: Map<string, Record<string, string>> = new Map();

  /** Normalized inbound message handler */
  #mualij: ((risala: RisalaDakhila) => Promise<void>) | null = null;

  constructor(telegram: TelegramClient) {
    this.#telegram = telegram;
  }

  // ─── Rasul: inbound lifecycle ──────────────────────────────────────────────

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

  // ─── Rasul: outbound ───────────────────────────────────────────────────────

  mumakkan(): boolean {
    return this.#telegram.mumakkan();
  }

  async send(channel: QanatRisala, text: string): Promise<void> {
    if (!this.mumakkan()) return;

    if (channel === "dispatch") {
      await this.#telegram.sendToDispatch(text);
      return;
    }

    if (channel === "kimyawi") {
      await this.#telegram.arsalaRisala(text);
      return;
    }

    /** { murshid: id } */
    const topicId = this.#resolveMurshidTopic(channel.murshid);
    if (topicId !== null) {
      await this.#telegram.arsalaIlaMurshidTopic(topicId, text);
    } else {
      await this.#telegram.sendToDispatch(`[${channel.murshid}] ${text}`);
    }
  }

  async arsalaMunassaq(channel: QanatRisala, text: string): Promise<void> {
    if (!this.mumakkan()) return;

    if (channel === "dispatch") {
      await this.#telegram.sendToDispatch(text, { parseMode: "Markdown" });
      return;
    }

    if (channel === "kimyawi") {
      await this.#telegram.arsalaRisala(text, { parseMode: "Markdown" });
      return;
    }

    /** { murshid: id } */
    const topicId = this.#resolveMurshidTopic(channel.murshid);
    if (topicId !== null) {
      await this.#telegram.arsalaIlaMurshidTopic(topicId, text, { parseMode: "Markdown" });
    } else {
      await this.#telegram.sendToDispatch(`[${channel.murshid}] ${text}`, { parseMode: "Markdown" });
    }
  }

  // ─── Rasul: interactive ────────────────────────────────────────────────────

  async arsalaSualBiKhiyarat(
    channel: QanatRisala,
    nass: string,
    khiyarat: KhiyarTafauli[],
  ): Promise<number | null> {
    if (!this.mumakkan()) return null;

    const keyboard = {
      inline_keyboard: khiyarat.map((k) => [
        { text: k.nass, callback_data: k.miftah },
      ]),
    };

    if (channel === "dispatch") {
      return await this.#telegram.sendToDispatch(nass, {
        parseMode: "Markdown",
        keyboard,
      });
    }

    if (channel === "kimyawi") {
      return await this.#telegram.arsalaRisala(nass, {
        parseMode: "Markdown",
        keyboard,
      });
    }

    /** { murshid: id } */
    const topicId = this.#resolveMurshidTopic(channel.murshid);
    if (topicId !== null) {
      return await this.#telegram.arsalaIlaMurshidTopic(topicId, nass, {
        parseMode: "Markdown",
        keyboard,
      });
    }

    return await this.#telegram.sendToDispatch(`[${channel.murshid}] ${nass}`, {
      parseMode: "Markdown",
      keyboard,
    });
  }

  // ─── Channel management ────────────────────────────────────────────────────

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
    /** Check cache first, then DB */
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

  // ─── Inbound routing (Telegram → RisalaDakhila) ───────────────────────────

  /**
   * Wire up Telegram onMessage / onCallback to emit normalized events.
   * This is the logic that used to live in main.ts addaMualijatTelegram().
   */
  #rabatMualijat(): void {
    this.#telegram.onMessage(async (message) => {
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

      /** Private chat → khass */
      if (isPrivateMessage) {
        await this.#mualij({ naw: "khass" });
        return;
      }

      if (!isGroupMessage) {
        await logger.haDHHir("messenger", "Message from unknown chat type");
        return;
      }

      /** Dispatch topic → irsal or amr */
      if (isDispatchTopic) {
        if (text.startsWith("/")) {
          const [command, ...args] = text.slice(1).split(" ");
          await this.#mualij({ naw: "amr", amr: command.toLowerCase(), wusut: args });
        } else {
          await this.#mualij({ naw: "irsal", nass: text, huwiyyatRisala: message.message_id });
        }
        return;
      }

      /** Murshid topic → murshid message */
      if (topicId) {
        const huwiyya = this.hallJalsaBilQanat(MUQADDIM, String(topicId));
        if (huwiyya) {
          await this.#mualij({ naw: "murshid", huwiyya, nass: text });
        } else if (topicId === 1) {
          /** General topic — not linked */
          await this.#telegram.arsalaRisala(
            "Use the **Dispatch** topic to name a waṣfa and light a murshid.",
            { topicId: 1, chatId: this.#telegram.getGroupId(), parseMode: "Markdown" },
          );
        } else {
          await this.#telegram.arsalaRisala(
            "This topic is not linked to an active murshid.",
            { topicId, chatId: this.#telegram.getGroupId() },
          );
        }
        return;
      }

      await logger.haDHHir("messenger", "Group message without topic ID");
    });

    this.#telegram.onCallback(async (query) => {
      if (!query.data) {
        await this.#telegram.answerCallback(query.id, "Received!");
        return;
      }

      await logger.akhbar("messenger", `Callback: ${query.data}`);

      /** Question button → jawab_sual or idkhal_khass_sual */
      if (query.data.startsWith("q:")) {
        const parts = query.data.split(":");
        if (parts.length >= 3) {
          const shortId = parts[1];
          const selectedLabel = parts.slice(2).join(":");

          if (selectedLabel === "__custom__") {
            /** Need to resolve murshid from topic for custom input */
            const topicId = query.message?.message_thread_id;
            const huwiyya = topicId
              ? this.hallJalsaBilQanat(MUQADDIM, String(topicId))
              : null;

            if (huwiyya && this.#mualij) {
              await this.#mualij({
                naw: "idkhal_khass_sual",
                huwiyyatMurshid: huwiyya,
                huwiyyatSual: `short:${shortId}`,
              });
              await this.#telegram.answerCallback(query.id, "Type your answer as a reply...");
            } else {
              await this.#telegram.answerCallback(query.id, "Cannot resolve murshid for custom input");
            }
          } else if (this.#mualij) {
            await this.#mualij({
              naw: "jawab_sual",
              huwiyyatSual: `short:${shortId}`,
              taamiyya: selectedLabel,
            });
            await this.#telegram.answerCallback(query.id, `Selected: ${selectedLabel}`);
          }
        }
        return;
      }

      /** Munadi buttons (select/parent/switch/cancel) */
      if (
        query.data.startsWith("select:") ||
        query.data.startsWith("parent:") ||
        query.data.startsWith("switch:") ||
        query.data === "cancel"
      ) {
        if (this.#mualij) {
          await this.#mualij({ naw: "ikhtiyar_munadi", miftah: query.data });
        }
        await this.#telegram.answerCallback(query.id, "Received!");
        return;
      }

      await this.#telegram.answerCallback(query.id, "Received!");
    });
  }

  // ─── Private helpers ───────────────────────────────────────────────────────

  #resolveMurshidTopic(identifier: string): number | null {
    /** Check cache */
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
    /** Update session → channels cache */
    const existing = this.#sessionChannels.get(identifier) ?? {};
    existing[provider] = channelId;
    this.#sessionChannels.set(identifier, existing);

    this.#channelCache.set(`${provider}:${channelId}`, identifier);
  }
}

/**
 * Create a TelegramMessenger instance.
 */
export function anshaaTelegramRasul(telegram: TelegramClient): TelegramMessenger {
  return new TelegramMessenger(telegram);
}
