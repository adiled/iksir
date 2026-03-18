/**
 * TelegramMessenger — RasulKharij adapter for Telegram
 *
 * Translates the generic RasulKharij interface into TelegramClient
 * calls + channel DB persistence. Daemon modules depend on RasulKharij,
 * never on TelegramClient directly.
 *
 * Channel resolution:
 *   "dispatch"              → TelegramClient.sendToDispatch()
 *   "kimyawi"                → TelegramClient.arsalaRisala() (private chat)
 *   { murshid: id }    → lookup channels table, arsalaIlaMurshidTopic()
 *                              fallback: dispatch with [id] prefix
 */

import { logger } from "../logging/logger.ts";
import { TelegramClient, TOPIC_COLORS } from "./telegram.ts";
import {
  haddathaAwAdkhalaQanat,
  jalabaQanat,
  jalabaQanatsForSession,
  jalabJalsaByChannel,
} from "../../db/db.ts";
import type { RasulKharij, QanatRisala } from "../types.ts";

/** Re-export for convenience — channel DB functions used by main.ts for inbound routing */
export { jalabaQanat, jalabaQanatsForSession, jalabJalsaByChannel } from "../../db/db.ts";

export class TelegramMessenger implements RasulKharij {
  #telegram: TelegramClient;

  /** In-memory cache: provider:channelId → sessionIdentifier (reverse lookup) */
  #channelCache: Map<string, string> = new Map();

  /** In-memory cache: sessionIdentifier → Record<provider, channelId> */
  #sessionChannels: Map<string, Record<string, string>> = new Map();

  constructor(telegram: TelegramClient) {
    this.#telegram = telegram;
  }


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

  async khalaqaQanatMurshid(identifier: string, title: string): Promise<string | null> {
    if (!this.#telegram.isGroupMode()) {
      return null;
    }

    const topicName = `${identifier}: ${title}`.slice(0, 128);
    const topic = await this.#telegram.createForumTopic(topicName, {
      iconColor: TOPIC_COLORS.blue,
    });

    if (!topic) {
      await logger.warn("messenger", `Failed to create Telegram topic for ${identifier}`);
      return null;
    }

    const channelId = String(topic.message_thread_id);

    haddathaAwAdkhalaQanat(identifier, "telegram", channelId, {
      name: topicName,
      iconColor: TOPIC_COLORS.blue,
    });

    this.#cacheChannel(identifier, "telegram", channelId);

    await logger.info("messenger", `Created Telegram topic for ${identifier}`, {
      topicId: topic.message_thread_id,
    });

    return channelId;
  }

  yamlikQanatMurshid(identifier: string): boolean {
    /** Check cache first, then DB */
    const cached = this.#sessionChannels.get(identifier);
    if (cached && cached["telegram"]) return true;

    const dbChannel = jalabaQanat(identifier, "telegram");
    if (dbChannel) {
      this.#cacheChannel(identifier, "telegram", dbChannel);
      return true;
    }
    return false;
  }


  /**
   * Load all channels from DB into cache. Call once at startup.
   * Uses jalabaQanatsForSession for each known identifier.
   */
  hammalQanawatLilJalsa(identifier: string): Record<string, string> {
    const channels = jalabaQanatsForSession(identifier);
    this.#sessionChannels.set(identifier, channels);
    for (const [provider, channelId] of Object.entries(channels)) {
      this.#channelCache.set(`${provider}:${channelId}`, identifier);
    }
    return channels;
  }

  /**
   * Reverse lookup: find murshid identifier by provider + channelId.
   * Checks cache first, then DB.
   */
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

  /**
   * Get the underlying TelegramClient for inbound operations
   * (polling, callbacks, message routing). Only main.ts should use this.
   */
  get client(): TelegramClient {
    return this.#telegram;
  }


  #resolveMurshidTopic(identifier: string): number | null {
    /** Check cache */
    const cached = this.#sessionChannels.get(identifier);
    if (cached?.["telegram"]) {
      return parseInt(cached["telegram"], 10);
    }

    const dbChannel = jalabaQanat(identifier, "telegram");
    if (dbChannel) {
      this.#cacheChannel(identifier, "telegram", dbChannel);
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
