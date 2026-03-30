/**
 * Telegram Bot Client
 *
 * Send messages and receive commands via Telegram Bot API.
 * Supports inline keyboards, message formatting, and polling.
 *
 * Supports optional SOCKS5 proxy via TELEGRAM_PROXY env var.
 * Example: TELEGRAM_PROXY=socks5://localhost:1080
 */

import { logger } from "../logging/logger.ts";
import { execCommand } from "../utils/exec.ts";
import { escapeMarkdown, escapeMarkdownV2 } from "../utils/strings.ts";
import type { TasmimIksir, Ishara, TaaliqMuraja } from "../types.ts";
import { PROTOCOL_SOCKS5, TELEGRAM_API_BASE } from "../constants.ts";

/**
 * Fetch wrapper that uses SOCKS5 proxy for Telegram API if configured.
 * Uses execCommand to call curl with --socks5 flag.
 */
async function proxyFetch(
  url: string,
  proxy: string,
  options?: RequestInit
): Promise<Response> {
  if (!proxy) {
    return fetch(url, options);
  }

  /** Use curl with SOCKS5 proxy */
  const method = options?.method ?? "GET";
  const headers = options?.headers as Record<string, string> | undefined;
  const body = options?.body as string | undefined;

  const args = [
    "--silent",
    "--show-error",
    "--socks5", proxy.replace(PROTOCOL_SOCKS5, ""),
    "-X", method,
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
  args.push(url);

  const result = await execCommand("curl", args, {
    signal: options?.signal as AbortSignal | undefined,
  });

  if (result.code !== 0) {
    throw new Error(`curl failed: ${result.stderr}`);
  }

  /** Parse curl -i output (headers + body) */
  const output = result.stdout;
  const headerEndIndex = output.indexOf("\r\n\r\n");

  if (headerEndIndex === -1) {
    return new Response(output, { status: 200 });
  }

  const headerSection = output.slice(0, headerEndIndex);
  const bodySection = output.slice(headerEndIndex + 4);

  /** Parse status from first line (e.g., "HTTP/1.1 200 OK") */
  const statusMatch = headerSection.match(/HTTP\/[\d.]+ (\d+)/);
  const status = statusMatch ? parseInt(statusMatch[1], 10) : 200;

  /** Parse headers */
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

interface TelegramMessage {
  message_id: number;
  /** Topic ID if in a forum topic (1 = General topic) */
  message_thread_id?: number;
  /** True if this message is in a topic */
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

/** Forum topic colors (Telegram predefined) */
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

interface TelegramCallbackQuery {
  id: string;
  from: {
    id: number;
    username?: string;
  };
  message?: TelegramMessage;
  data?: string;
}

interface TelegramUpdate {
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
  private botToken: string;
  private chatId: string;
  private groupId: string | undefined;
  private dispatchTopicId: number | undefined;
  private enabled: boolean;
  private baseUrl: string;
  private proxy: string;
  private pollingOffset = 0;
  private isPolling = false;
  private pollAbortController: AbortController | null = null;

  private messageHandlers: MessageHandler[] = [];
  private callbackHandlers: CallbackHandler[] = [];

  constructor(config: TasmimIksir) {
    this.botToken = config.notifications.telegram.botToken;
    this.chatId = config.notifications.telegram.chatId;
    this.groupId = config.notifications.telegram.groupId;
    this.dispatchTopicId = config.notifications.telegram.dispatchTopicId;
    this.enabled = config.notifications.telegram.enabled;
    this.proxy = config.notifications.telegram.proxy ?? "";
    this.baseUrl = `${TELEGRAM_API_BASE}/bot${this.botToken}`;
  }

  /**
   * Get the group ID if configured
   */
  getGroupId(): string | undefined {
    return this.groupId;
  }

  /**
   * Get the private chat ID
   */
  getChatId(): string {
    return this.chatId;
  }

  /**
   * Get the dispatch topic ID if configured
   */
  getDispatchTopicId(): number | undefined {
    return this.dispatchTopicId;
  }

  /**
   * Check if group mode is enabled (has both group ID and dispatch topic)
   */
  isGroupMode(): boolean {
    return Boolean(this.groupId && this.dispatchTopicId);
  }

  /**
   * Get the effective chat ID for operations (group if available, else private)
   */
  getEffectiveChatId(): string {
    return this.groupId ?? this.chatId;
  }

  /**
   * Check if Telegram notifications are enabled
   */
  mumakkan(): boolean {
    return this.enabled;
  }

  /**
   * Validate that the bot token works
   */
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

  /** @deprecated Use the shared escapeMarkdownV2() from utils/strings.ts directly */
  escapeMarkdownV2(text: string): string {
    return escapeMarkdownV2(text);
  }

  /** @deprecated Use the shared escapeMarkdown() from utils/strings.ts directly */
  escapeMarkdown(text: string): string {
    return escapeMarkdown(text);
  }

  /**
   * Send a message, optionally to a specific topic
   */
  async arsalaRisala(
    text: string,
    options?: {
      parseMode?: "Markdown" | "MarkdownV2" | "HTML";
      keyboard?: InlineKeyboardMarkup;
      disableNotification?: boolean;
      /** Topic ID to send to (omit for General topic) */
      topicId?: number;
      /** Override chat ID (defaults to group if available, else private chat) */
      chatId?: string;
    }
  ): Promise<number | null> {
    if (!this.enabled) {
      await logger.warn("telegram", "Telegram notifications are disabled, skipping");
      return null;
    }

    /** Use provided chatId, or group if available, or private chat */
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
      const response = await proxyFetch(`${this.baseUrl}/arsalaRisala`, this.proxy, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await response.json();

      if (data.ok) {
        const topicInfo = options?.topicId ? ` [topic:${options.topicId}]` : "";
        await logger.notification("telegram", "message", targetChatId, text.slice(0, 50) + topicInfo, true);
        return data.result.message_id;
      }

      await logger.error("telegram", "Failed to send message", { error: data.description });
      await logger.notification("telegram", "message", targetChatId, text.slice(0, 50), false);
      return null;
    } catch (error) {
      await logger.error("telegram", "Network error sending message", { error: String(error) });
      await logger.notification("telegram", "message", targetChatId, text.slice(0, 50), false);
      return null;
    }
  }

  /**
   * Send a message with fallback chain: Markdown → plain text.
   * Use this when the message may contain user-generated content with special chars.
   */
  async arsalaRisalaWithFallback(
    text: string,
    options?: {
      keyboard?: InlineKeyboardMarkup;
      disableNotification?: boolean;
      topicId?: number;
      chatId?: string;
    }
  ): Promise<number | null> {
    /** Try Markdown first */
    const result = await this.arsalaRisala(text, {
      ...options,
      parseMode: "Markdown",
    });

    if (result !== null) {
      return result;
    }

    await logger.warn("telegram", "Markdown failed, retrying as plain text");
    return this.arsalaRisala(text, {
      ...options,
      parseMode: undefined,
    });
  }

  /**
   * Send a message to the dispatch topic (for spawning orchestrators)
   */
  async sendToDispatch(
    text: string,
    options?: {
      parseMode?: "Markdown" | "MarkdownV2" | "HTML";
      keyboard?: InlineKeyboardMarkup;
    }
  ): Promise<number | null> {
    if (!this.isGroupMode()) {
      return this.arsalaRisalaWithFallback(text, options);
    }

    return this.arsalaRisalaWithFallback(text, {
      ...options,
      chatId: this.groupId,
      topicId: this.dispatchTopicId,
    });
  }

  /**
   * Send a message to an orchestrator's topic
   */
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


  /**
   * Create a forum topic for an orchestrator session.
   * Requires a forum-enabled supergroup (groupId must be set).
   */
  async createForumTopic(
    name: string,
    options?: {
      iconColor?: number;
      iconCustomEmojiId?: string;
    }
  ): Promise<ForumTopic | null> {
    if (!this.enabled) return null;
    if (!this.groupId) {
      await logger.warn("telegram", "Cannot create forum topic: no groupId configured");
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
        await logger.info("telegram", `Created forum topic: ${name}`, {
          topicId: data.result.message_thread_id,
        });
        return data.result as ForumTopic;
      }

      await logger.error("telegram", "Failed to create forum topic", { error: data.description });
      return null;
    } catch (error) {
      await logger.error("telegram", "Network error creating forum topic", { error: String(error) });
      return null;
    }
  }

  /**
   * Close a forum topic (hides it but preserves history)
   */
  async closeForumTopic(topicId: number): Promise<boolean> {
    if (!this.enabled || !this.groupId) return false;

    try {
      const response = await proxyFetch(`${this.baseUrl}/closeForumTopic`, this.proxy, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: this.groupId,
          message_thread_id: topicId,
        }),
      });

      const data = await response.json();
      if (data.ok) {
        await logger.info("telegram", `Closed forum topic: ${topicId}`);
      }
      return data.ok === true;
    } catch {
      return false;
    }
  }

  /**
   * Reopen a closed forum topic
   */
  async reopenForumTopic(topicId: number): Promise<boolean> {
    if (!this.enabled || !this.groupId) return false;

    try {
      const response = await proxyFetch(`${this.baseUrl}/reopenForumTopic`, this.proxy, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: this.groupId,
          message_thread_id: topicId,
        }),
      });

      const data = await response.json();
      return data.ok === true;
    } catch {
      return false;
    }
  }

  /**
   * Delete a forum topic (removes it and all messages)
   */
  async deleteForumTopic(topicId: number): Promise<boolean> {
    if (!this.enabled || !this.groupId) return false;

    try {
      const response = await proxyFetch(`${this.baseUrl}/deleteForumTopic`, this.proxy, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: this.groupId,
          message_thread_id: topicId,
        }),
      });

      const data = await response.json();
      if (data.ok) {
        await logger.info("telegram", `Deleted forum topic: ${topicId}`);
      }
      return data.ok === true;
    } catch {
      return false;
    }
  }

  /**
   * Edit a forum topic's name or icon
   */
  async editForumTopic(
    topicId: number,
    options: {
      name?: string;
      iconCustomEmojiId?: string;
    }
  ): Promise<boolean> {
    if (!this.enabled || !this.groupId) return false;

    const body: Record<string, unknown> = {
      chat_id: this.groupId,
      message_thread_id: topicId,
    };

    if (options.name) {
      body.name = options.name.slice(0, 128);
    }
    if (options.iconCustomEmojiId) {
      body.icon_custom_emoji_id = options.iconCustomEmojiId;
    }

    try {
      const response = await proxyFetch(`${this.baseUrl}/editForumTopic`, this.proxy, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await response.json();
      return data.ok === true;
    } catch {
      return false;
    }
  }

  /**
   * Get the topic ID from a message (1 = General, undefined = no topics)
   */
  jalabRisalaTopicId(message: TelegramMessage): number | undefined {
    return message.message_thread_id;
  }

  /**
   * Check if a message is from the General topic (or no topic)
   */
  isGeneralTopic(message: TelegramMessage): boolean {
    return !message.message_thread_id || message.message_thread_id === 1;
  }

  /**
   * Answer a callback query (removes loading spinner from button)
   */
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

  /**
   * Edit a message
   */
  async editMessage(messageId: number, text: string, keyboard?: InlineKeyboardMarkup): Promise<boolean> {
    if (!this.enabled) return false;

    const body: Record<string, unknown> = {
      chat_id: this.chatId,
      message_id: messageId,
      text,
    };

    if (keyboard) {
      body.reply_markup = keyboard;
    }

    try {
      const response = await proxyFetch(`${this.baseUrl}/editMessageText`, this.proxy, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await response.json();
      return data.ok === true;
    } catch {
      return false;
    }
  }

  /**
   * Send a notification (unified interface)
   */
  async sendNotification(notification: Ishara): Promise<number | null> {
    const emoji = this.getCategoryEmoji(notification.category);
    const text = `${emoji} *${notification.title}*\n\n${notification.body}`;

    const keyboard = notification.actions
      ? this.buildKeyboard(notification.actions.map((a) => ({ text: a.label, callback_data: a.action })))
      : undefined;

    return this.arsalaRisala(text, {
      parseMode: "Markdown",
      keyboard,
      disableNotification: notification.awwaliyya === "min" || notification.awwaliyya === "low",
    });
  }

  /**
   * Get emoji for notification category
   */
  private getCategoryEmoji(category: string): string {
    const emojis: Record<string, string> = {
      blocker: "🚫",
      decision: "🤔",
      progress: "📊",
      pr_ready: "✅",
      review_comments: "💬",
      milestone: "🎉",
      external_change: "⚠️",
      quiet_hours_exit: "☀️",
    };
    return emojis[category] ?? "📢";
  }

  /**
   * Build an inline keyboard
   */
  private buildKeyboard(buttons: Array<{ text: string; callback_data?: string; url?: string }>): InlineKeyboardMarkup {
    /** Arrange buttons in rows of 2 */
    const rows: InlineKeyboardButton[][] = [];
    for (let i = 0; i < buttons.length; i += 2) {
      rows.push(buttons.slice(i, i + 2));
    }
    return { inline_keyboard: rows };
  }

  /**
   * Send project started message
   */
  async sendProjectStarted(
    projectId: string,
    title: string,
    epicBranch: string,
    tickets: Array<{ id: string; title: string; estimate: number | null }>
  ): Promise<number | null> {
    const ticketList = tickets.map((t) => `  ${t.id}: ${t.title} (${t.estimate ?? "?"} pts)`).join("\n");
    const totalPoints = tickets.reduce((sum, t) => sum + (t.estimate ?? 0), 0);

    const text = `📋 *Project Started: ${projectId}*

${title}

Epic branch: \`${epicBranch}\`

Ticket breakdown:
${ticketList}

Total: ${totalPoints} story points

Beginning work...`;

    return this.arsalaRisala(text, { parseMode: "Markdown" });
  }

  /**
   * Send progress update
   */
  async sendProgress(
    projectId: string,
    completed: Array<{ id: string; raqamRisala?: number }>,
    inProgress: Array<{ id: string; progress: number }>,
    pending: string[]
  ): Promise<number | null> {
    const completedList =
      completed.length > 0
        ? completed.map((t) => `  ✓ ${t.id}${t.raqamRisala ? ` (PR #${t.raqamRisala})` : ""}`).join("\n")
        : "  (none)";

    const inProgressList =
      inProgress.length > 0
        ? inProgress.map((t) => `  → ${t.id} (${t.progress}%)`).join("\n")
        : "  (none)";

    const pendingList = pending.length > 0 ? pending.map((id) => `  ○ ${id}`).join("\n") : "  (none)";

    const total = completed.length + inProgress.length + pending.length;
    const percent = total > 0 ? Math.round((completed.length / total) * 100) : 0;

    const text = `📊 *Progress: ${projectId}*

Completed:
${completedList}

In Progress:
${inProgressList}

Pending:
${pendingList}

Overall: ${percent}% complete`;

    return this.arsalaRisala(text, { parseMode: "Markdown" });
  }

  /**
   * Send review comments summary
   */
  async sendTaaliqMurajas(raqamRisala: number, comments: TaaliqMuraja[]): Promise<number | null> {
    const byAuthor = new Map<string, TaaliqMuraja[]>();
    for (const comment of comments) {
      const existing = byAuthor.get(comment.author) ?? [];
      existing.push(comment);
      byAuthor.set(comment.author, existing);
    }

    let text = `💬 *Review Comments: PR #${raqamRisala}*\n\n`;

    for (const [author, authorComments] of byAuthor) {
      text += `@${author} (${authorComments.length} comment${authorComments.length > 1 ? "s" : ""}):\n\n`;

      for (let i = 0; i < authorComments.length; i++) {
        const c = authorComments[i];
        const location = c.path ? `Line ${c.line ?? "?"} in ${c.path}` : "General";
        const bodyPreview = c.body.length > 100 ? c.body.slice(0, 100) + "..." : c.body;

        text += `${i + 1}. ${location}:\n`;
        text += `   "${bodyPreview}"\n`;
        text += `   → Assessment: ${c.assessment.intent}\n\n`;
      }
    }

    text += "Awaiting your direction.";

    return this.arsalaRisala(text, { parseMode: "Markdown" });
  }

  /**
   * Register a message handler
   */
  onMessage(handler: MessageHandler): void {
    this.messageHandlers.push(handler);
  }

  /**
   * Register a callback query handler
   */
  onCallback(handler: CallbackHandler): void {
    this.callbackHandlers.push(handler);
  }

  /**
   * Start polling for updates
   */
  async startPolling(): Promise<void> {
    if (!this.enabled) {
      await logger.warn("telegram", "Telegram is disabled, not starting polling");
      return;
    }

    if (this.isPolling) {
      await logger.warn("telegram", "Already polling");
      return;
    }

    this.isPolling = true;
    this.pollAbortController = new AbortController();
    await logger.info("telegram", "Starting Telegram polling");

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
        await logger.error("telegram", "Polling error", { error: String(error) });
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }
    }

    await logger.info("telegram", "Stopped Telegram polling");
  }

  /**
   * Stop polling
   */
  stopPolling(): void {
    this.isPolling = false;
    if (this.pollAbortController) {
      this.pollAbortController.abort();
      this.pollAbortController = null;
    }
  }

  /**
   * Handle an incoming update
   */
  private async handleUpdate(update: TelegramUpdate): Promise<void> {
    /** Validate chat ID for security - allow private chat OR group */
    const chatId = update.message?.chat.id ?? update.callback_query?.message?.chat.id;
    const chatIdStr = chatId ? String(chatId) : undefined;
    
    const isAuthorized = chatIdStr && (
      chatIdStr === this.chatId || 
      chatIdStr === this.groupId
    );
    
    if (chatId && !isAuthorized) {
      await logger.warn("telegram", "Received update from unauthorized chat", { chatId });
      return;
    }

    if (update.message) {
      for (const handler of this.messageHandlers) {
        try {
          await handler(update.message);
        } catch (error) {
          await logger.error("telegram", "Message handler error", { error: String(error) });
        }
      }
    }

    if (update.callback_query) {
      for (const handler of this.callbackHandlers) {
        try {
          await handler(update.callback_query);
        } catch (error) {
          await logger.error("telegram", "Callback handler error", { error: String(error) });
        }
      }
    }
  }

  /**
   * Check if a message is from the dispatch topic
   */
  isDispatchTopic(message: TelegramMessage): boolean {
    if (!this.dispatchTopicId) return false;
    return message.message_thread_id === this.dispatchTopicId;
  }

  /**
   * Check if a message is from the group
   */
  isGroupMessage(message: TelegramMessage): boolean {
    return this.groupId ? String(message.chat.id) === this.groupId : false;
  }

  /**
   * Check if a message is from private chat
   */
  isPrivateMessage(message: TelegramMessage): boolean {
    return String(message.chat.id) === this.chatId;
  }
}

/**
 * Create a Telegram client instance
 */
export function createTelegramClient(config: TasmimIksir): TelegramClient {
  return new TelegramClient(config);
}


