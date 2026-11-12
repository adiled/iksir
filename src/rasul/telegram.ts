/**
 * Telegram Bot Client
 *
 * Send messages and receive commands via Telegram Bot API.
 * Supports inline keyboards, message formatting, and polling.
 *
 * Reads al-Tasmīm at the moment of every call: the bot token from the
 * secrets (telegram.ramz), the chat, hall, Dispatch topic and SOCKS5 proxy
 * from khabath.telegram. Change them on disk and the next call uses them.
 */

import { logger } from "../logging/logger.ts";
import { execCommand } from "../utils/exec.ts";
import { escapeMarkdown, escapeMarkdownV2 } from "../utils/strings.ts";
import type { Tasmim } from "../config.ts";
import { PROTOCOL_SOCKS5, TELEGRAM_API_BASE } from "../constants.ts";

async function proxyFetch(
  url: string,
  proxy: string,
  options?: RequestInit
): Promise<Response> {
  if (!proxy) {
    return fetch(url, options);
  }

  const method = options?.method ?? "GET";
  const headers = options?.headers as Record<string, string> | undefined;
  const body = options?.body as string | undefined;

  const args = [
    "--silent",
    "--show-error",
    "--socks5-hostname", proxy.replace(PROTOCOL_SOCKS5, ""),
    "-X", method,
    "--config", "-",
  ];

  if (headers) {
    for (const [key, value] of Object.entries(headers)) {
      args.push("-H", `${key}: ${value}`);
    }
  }

  if (body) {
    args.push("-d", body);
  }

  args.push("-i");

  const result = await execCommand("curl", args, {
    signal: options?.signal as AbortSignal | undefined,
    input: `url = ${JSON.stringify(url)}\n`,
  });

  if (result.code !== 0) {
    throw new Error(`curl failed: ${result.stderr}`);
  }

  const output = result.stdout;
  const headerEndIndex = output.indexOf("\r\n\r\n");

  if (headerEndIndex === -1) {
    return new Response(output, { status: 200 });
  }

  const headerSection = output.slice(0, headerEndIndex);
  const bodySection = output.slice(headerEndIndex + 4);

  const statusMatch = headerSection.match(/HTTP\/[\d.]+ (\d+)/);
  const status = statusMatch ? parseInt(statusMatch[1], 10) : 200;

  const responseHeaders = new Headers();
  const headerLines = headerSection.split("\r\n").slice(1);
  for (const line of headerLines) {
    const colonIndex = line.indexOf(":");
    if (colonIndex > 0) {
      const key = line.slice(0, colonIndex).trim();
      const value = line.slice(colonIndex + 1).trim();
      responseHeaders.set(key, value);
    }
  }

  return new Response(bodySection, { status, headers: responseHeaders });
}

export interface TelegramMessage {
  message_id: number;
  message_thread_id?: number;
  is_topic_message?: boolean;
  from?: {
    id: number;
    username?: string;
  };
  chat: {
    id: number;
  };
  text?: string;
  date: number;
}

export const TOPIC_COLORS = {
  blue: 0x6FB9F0,
  yellow: 0xFFD67E,
  purple: 0xCB86DB,
  green: 0x8EEE98,
  pink: 0xFF93B2,
  red: 0xFB6F5F,
} as const;

interface ForumTopic {
  message_thread_id: number;
  name: string;
  icon_color?: number;
  icon_custom_emoji_id?: string;
}

export interface TelegramCallbackQuery {
  id: string;
  from: {
    id: number;
    username?: string;
  };
  message?: TelegramMessage;
  data?: string;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
}

interface InlineKeyboardButton {
  text: string;
  callback_data?: string;
  url?: string;
}

interface InlineKeyboardMarkup {
  inline_keyboard: InlineKeyboardButton[][];
}

type MessageHandler = (message: TelegramMessage) => Promise<void>;
type CallbackHandler = (query: TelegramCallbackQuery) => Promise<void>;

export class TelegramClient {
  #tasmim: Tasmim;
  private pollingOffset = 0;
  private isPolling = false;
  private pollAbortController: AbortController | null = null;

  private messageHandlers: MessageHandler[] = [];
  private callbackHandlers: CallbackHandler[] = [];

  constructor(tasmim: Tasmim) {
    this.#tasmim = tasmim;
  }

  private get botToken(): string {
    return this.#tasmim.sirr("telegram.ramz") ?? "";
  }

  private get chatId(): string {
    return this.#tasmim.khabath().telegram?.muhadatha ?? "";
  }

  private get groupId(): string | undefined {
    return this.#tasmim.khabath().telegram?.majmuua || undefined;
  }

  private get dispatchTopicId(): number | undefined {
    const m = this.#tasmim.khabath().telegram?.mawduuIrsal;
    return m === undefined || m === null ? undefined : Number(m);
  }

  private get proxy(): string {
    return this.#tasmim.khabath().telegram?.proxy ?? "";
  }

  private get enabled(): boolean {
    return this.#tasmim.khabath().majlis.includes("telegram") && this.botToken !== "";
  }

  private get baseUrl(): string {
    return `${TELEGRAM_API_BASE}/bot${this.botToken}`;
  }

  getGroupId(): string | undefined {
    return this.groupId;
  }

  getChatId(): string {
    return this.chatId;
  }

  getDispatchTopicId(): number | undefined {
    return this.dispatchTopicId;
  }

  isGroupMode(): boolean {
    return Boolean(this.groupId && this.dispatchTopicId);
  }

  getEffectiveChatId(): string {
    return this.groupId ?? this.chatId;
  }

  mumakkan(): boolean {
    return this.enabled;
  }

  async tahaqqaqToken(): Promise<boolean> {
    if (!this.enabled) return false;

    try {
      const response = await proxyFetch(`${this.baseUrl}/getMe`, this.proxy);
      const data = await response.json();
      return data.ok === true;
    } catch {
      return false;
    }
  }

  escapeMarkdownV2(text: string): string {
    return escapeMarkdownV2(text);
  }

  escapeMarkdown(text: string): string {
    return escapeMarkdown(text);
  }

  async arsalaRisala(
    text: string,
    options?: {
      parseMode?: "Markdown" | "MarkdownV2" | "HTML";
      keyboard?: InlineKeyboardMarkup;
      disableNotification?: boolean;
      topicId?: number;
      chatId?: string;
    }
  ): Promise<number | null> {
    if (!this.enabled) {
      await logger.haDHHir("telegram", "Telegram notifications are disabled, skipping");
      return null;
    }

    const targetChatId = options?.chatId ?? this.getEffectiveChatId();

    const body: Record<string, unknown> = {
      chat_id: targetChatId,
      text,
    };

    if (options?.topicId) {
      body.message_thread_id = options.topicId;
    }
    if (options?.parseMode) {
      body.parse_mode = options.parseMode;
    }
    if (options?.keyboard) {
      body.reply_markup = options.keyboard;
    }
    if (options?.disableNotification) {
      body.disable_notification = true;
    }

    try {
      const response = await proxyFetch(`${this.baseUrl}/sendMessage`, this.proxy, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await response.json();

      if (data.ok) {
        const topicInfo = options?.topicId ? ` [topic:${options.topicId}]` : "";
        await logger.sajjalIshara("telegram", "message", targetChatId, text.slice(0, 50) + topicInfo, true);
        return data.result.message_id;
      }

      if (options?.parseMode && /parse entities|can't parse/i.test(String(data.description))) {
        await logger.haDHHir("telegram", "Markdown refused, saying it plain", { error: data.description });
        return this.arsalaRisala(text, { ...options, parseMode: undefined });
      }

      await logger.sajjalKhata("telegram", "Failed to send message", { error: data.description });
      await logger.sajjalIshara("telegram", "message", targetChatId, text.slice(0, 50), false);
      return null;
    } catch (error) {
      await logger.sajjalKhata("telegram", "Network error sending message", { error: String(error) });
      await logger.sajjalIshara("telegram", "message", targetChatId, text.slice(0, 50), false);
      return null;
    }
  }

  async sendToDispatch(
    text: string,
    options?: {
      parseMode?: "Markdown" | "MarkdownV2" | "HTML";
      keyboard?: InlineKeyboardMarkup;
    }
  ): Promise<number | null> {
    if (!this.isGroupMode()) {
      return this.arsalaRisala(text, options);
    }

    return this.arsalaRisala(text, {
      ...options,
      chatId: this.groupId,
      topicId: this.dispatchTopicId,
    });
  }

  async arsalaIlaMurshidTopic(
    topicId: number,
    text: string,
    options?: {
      parseMode?: "Markdown" | "MarkdownV2" | "HTML";
      keyboard?: InlineKeyboardMarkup;
    }
  ): Promise<number | null> {
    if (!this.groupId) {
      return this.arsalaRisala(text, options);
    }

    return this.arsalaRisala(text, {
      ...options,
      chatId: this.groupId,
      topicId,
    });
  }

  async createForumTopic(
    name: string,
    options?: {
      iconColor?: number;
      iconCustomEmojiId?: string;
    }
  ): Promise<ForumTopic | null> {
    if (!this.enabled) return null;
    if (!this.groupId) {
      await logger.haDHHir("telegram", "Cannot create forum topic: no groupId configured");
      return null;
    }

    const body: Record<string, unknown> = {
      chat_id: this.groupId,
      name: name.slice(0, 128),
    };

    if (options?.iconColor) {
      body.icon_color = options.iconColor;
    }
    if (options?.iconCustomEmojiId) {
      body.icon_custom_emoji_id = options.iconCustomEmojiId;
    }

    try {
      const response = await proxyFetch(`${this.baseUrl}/createForumTopic`, this.proxy, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await response.json();

      if (data.ok) {
        await logger.akhbar("telegram", `Created forum topic: ${name}`, {
          topicId: data.result.message_thread_id,
        });
        return data.result as ForumTopic;
      }

      await logger.sajjalKhata("telegram", "Failed to create forum topic", { error: data.description });
      return null;
    } catch (error) {
      await logger.sajjalKhata("telegram", "Network error creating forum topic", { error: String(error) });
      return null;
    }
  }

  jalabRisalaTopicId(message: TelegramMessage): number | undefined {
    return message.message_thread_id;
  }

  isGeneralTopic(message: TelegramMessage): boolean {
    return !message.message_thread_id || message.message_thread_id === 1;
  }

  async answerCallback(callbackQueryId: string, text?: string): Promise<boolean> {
    try {
      const response = await proxyFetch(`${this.baseUrl}/answerCallbackQuery`, this.proxy, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          callback_query_id: callbackQueryId,
          text,
        }),
      });

      const data = await response.json();
      return data.ok === true;
    } catch {
      return false;
    }
  }

  onMessage(handler: MessageHandler): void {
    this.messageHandlers.push(handler);
  }

  onCallback(handler: CallbackHandler): void {
    this.callbackHandlers.push(handler);
  }

  async startPolling(): Promise<void> {
    if (!this.enabled) {
      await logger.haDHHir("telegram", "Telegram is disabled, not starting polling");
      return;
    }

    if (this.isPolling) {
      await logger.haDHHir("telegram", "Already polling");
      return;
    }

    this.isPolling = true;
    this.pollAbortController = new AbortController();
    await logger.akhbar("telegram", "Starting Telegram polling");

    while (this.isPolling) {
      try {
        const response = await proxyFetch(
          `${this.baseUrl}/getUpdates?offset=${this.pollingOffset}&timeout=30`,
          this.proxy,
          { signal: this.pollAbortController.signal }
        );

        const data = await response.json();

        if (data.ok && data.result) {
          for (const update of data.result as TelegramUpdate[]) {
            this.pollingOffset = update.update_id + 1;
            await this.handleUpdate(update);
          }
        }
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          break;
        }
        await logger.sajjalKhata("telegram", "Polling error", { error: String(error) });
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }
    }

    await logger.akhbar("telegram", "Stopped Telegram polling");
  }

  stopPolling(): void {
    this.isPolling = false;
    if (this.pollAbortController) {
      this.pollAbortController.abort();
      this.pollAbortController = null;
    }
  }

  private async handleUpdate(update: TelegramUpdate): Promise<void> {
    const chatId = update.message?.chat.id ?? update.callback_query?.message?.chat.id;
    const chatIdStr = chatId ? String(chatId) : undefined;
    
    const isAuthorized = chatIdStr && (
      chatIdStr === this.chatId || 
      chatIdStr === this.groupId
    );
    
    if (chatId && !isAuthorized) {
      await logger.haDHHir("telegram", "Received update from unauthorized chat", { chatId });
      return;
    }

    if (update.message) {
      for (const handler of this.messageHandlers) {
        try {
          await handler(update.message);
        } catch (error) {
          await logger.sajjalKhata("telegram", "Message handler error", { error: String(error) });
        }
      }
    }

    if (update.callback_query) {
      for (const handler of this.callbackHandlers) {
        try {
          await handler(update.callback_query);
        } catch (error) {
          await logger.sajjalKhata("telegram", "Callback handler error", { error: String(error) });
        }
      }
    }
  }

  isDispatchTopic(message: TelegramMessage): boolean {
    if (!this.dispatchTopicId) return false;
    return message.message_thread_id === this.dispatchTopicId;
  }

  isGroupMessage(message: TelegramMessage): boolean {
    return this.groupId ? String(message.chat.id) === this.groupId : false;
  }

  isPrivateMessage(message: TelegramMessage): boolean {
    return String(message.chat.id) === this.chatId;
  }
}

export function anshaaTelegramAmil(tasmim: Tasmim): TelegramClient {
  return new TelegramClient(tasmim);
}

