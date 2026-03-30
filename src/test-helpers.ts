/**
 * Shared Test Helpers
 *
 * Mock factories and utilities for Tier 2+ tests.
 * Provides typed mocks for OpenCodeClient, TelegramClient, MessengerOutbound,
 * and SessionManager. Uses real temp DB instances (same pattern as db_test.ts).
 */

import { initDatabase, closeDatabase, upsertSession } from "../db/db.ts";
import { execCommand } from "./utils/exec.ts";
import type { MessengerOutbound, MessageChannel, OrchestratorSession, QuestionAnswer } from "./types.ts";

// =============================================================================
// Temp DB helper (same pattern as db_test.ts)
// =============================================================================

/**
 * Run a test function with an isolated temp SQLite DB.
 * Sets MUNADI_STATE_DIR, initializes DB, runs fn, then cleans up.
 */
export async function withTestDb(fn: () => Promise<void> | void): Promise<void> {
  const tempDir = await Deno.makeTempDir({ prefix: "munadi-test-" });
  Deno.env.set("MUNADI_STATE_DIR", tempDir);
  try {
    await initDatabase();
    await fn();
  } finally {
    closeDatabase();
    Deno.env.delete("MUNADI_STATE_DIR");
    await Deno.remove(tempDir, { recursive: true });
  }
}

/**
 * Run a test function with both an isolated DB and an isolated git repo.
 * Creates a temp dir with `git init`, sets MUNADI_REPO_PATH + MUNADI_STATE_DIR,
 * initializes DB, runs fn, then cleans up everything.
 *
 * Use this for tests that exercise code paths involving git operations
 * (e.g. dispatcher → session-manager → git checkout).
 */
export async function withTestRepo(fn: () => Promise<void> | void): Promise<void> {
  const tempDir = await Deno.makeTempDir({ prefix: "munadi-repo-test-" });
  const prevRepo = Deno.env.get("MUNADI_REPO_PATH");
  Deno.env.set("MUNADI_REPO_PATH", tempDir);
  Deno.env.set("MUNADI_STATE_DIR", tempDir);
  try {
    // Initialize a bare git repo so git operations succeed
    await execCommand("git", ["init"], { cwd: tempDir });
    await execCommand("git", ["commit", "--allow-empty", "-m", "init"], { cwd: tempDir });
    await initDatabase();
    await fn();
  } finally {
    closeDatabase();
    Deno.env.delete("MUNADI_STATE_DIR");
    if (prevRepo) Deno.env.set("MUNADI_REPO_PATH", prevRepo);
    else Deno.env.delete("MUNADI_REPO_PATH");
    await Deno.remove(tempDir, { recursive: true });
  }
}

// =============================================================================
// OpenCode Client Mock
// =============================================================================

/** Minimal session shape returned by OpenCode mock */
interface MockOpenCodeSession {
  id: string;
  title: string;
  createdAt: Date;
  lastMessageAt: Date;
}

export interface MockOpenCodeClient {
  classify(prompt: string): Promise<{ success: boolean; response?: string; error?: string }>;
  replyToQuestion(
    sessionId: string,
    questionId: string,
    answers: QuestionAnswer[],
  ): Promise<boolean>;
  rejectQuestion(sessionId: string, questionId: string): Promise<boolean>;
  sendPromptAsync(sessionId: string, prompt: string, options?: unknown): Promise<boolean>;
  sendPrompt(
    sessionId: string,
    prompt: string,
    options?: unknown,
  ): Promise<{ success: boolean; response?: string; error?: string }>;
  createSession(ticketId: string, title: string): Promise<MockOpenCodeSession | null>;
  getSession(sessionId: string): Promise<MockOpenCodeSession | null>;
  listSessions(): Promise<Array<{ id: string; title: string; createdAt: Date; lastMessageAt: Date }>>;

  // Test inspection
  _calls: {
    classify: string[];
    replyToQuestion: Array<{ sessionId: string; questionId: string; answers: QuestionAnswer[] }>;
    rejectQuestion: Array<{ sessionId: string; questionId: string }>;
    sendPromptAsync: Array<{ sessionId: string; prompt: string }>;
    sendPrompt: Array<{ sessionId: string; prompt: string }>;
    createSession: Array<{ ticketId: string; title: string }>;
  };
  _sessions: Map<string, MockOpenCodeSession>;
}

/**
 * Create a mock OpenCodeClient. Override specific methods via the overrides param.
 * Includes session management (createSession, getSession) for integration tests.
 */
export function mockOpenCodeClient(overrides?: {
  classify?: (prompt: string) => Promise<{ success: boolean; response?: string; error?: string }>;
  replyToQuestion?: (
    sessionId: string,
    questionId: string,
    answers: QuestionAnswer[],
  ) => Promise<boolean>;
  rejectQuestion?: (sessionId: string, questionId: string) => Promise<boolean>;
  sendPromptAsync?: (sessionId: string, prompt: string) => Promise<boolean>;
  sendPrompt?: (sessionId: string, prompt: string) => Promise<{ success: boolean; response?: string; error?: string }>;
  createSession?: (ticketId: string, title: string) => Promise<MockOpenCodeSession | null>;
}): MockOpenCodeClient {
  const calls: MockOpenCodeClient["_calls"] = {
    classify: [],
    replyToQuestion: [],
    rejectQuestion: [],
    sendPromptAsync: [],
    sendPrompt: [],
    createSession: [],
  };

  const sessions = new Map<string, MockOpenCodeSession>();
  let sessionCounter = 0;

  return {
    _calls: calls,
    _sessions: sessions,

    async classify(prompt: string) {
      calls.classify.push(prompt);
      if (overrides?.classify) return overrides.classify(prompt);
      return { success: true, response: '{"classification":"WORTHY","reason":"test","rejection":null}' };
    },

    async replyToQuestion(sessionId, questionId, answers) {
      calls.replyToQuestion.push({ sessionId, questionId, answers });
      if (overrides?.replyToQuestion) return overrides.replyToQuestion(sessionId, questionId, answers);
      return true;
    },

    async rejectQuestion(sessionId, questionId) {
      calls.rejectQuestion.push({ sessionId, questionId });
      if (overrides?.rejectQuestion) return overrides.rejectQuestion(sessionId, questionId);
      return true;
    },

    async sendPromptAsync(sessionId, prompt) {
      calls.sendPromptAsync.push({ sessionId, prompt });
      if (overrides?.sendPromptAsync) return overrides.sendPromptAsync(sessionId, prompt);
      return true;
    },

    async sendPrompt(sessionId, prompt) {
      calls.sendPrompt.push({ sessionId, prompt });
      if (overrides?.sendPrompt) return overrides.sendPrompt(sessionId, prompt);
      return { success: true, response: "ok" };
    },

    async createSession(ticketId, title) {
      calls.createSession.push({ ticketId, title });
      if (overrides?.createSession) return overrides.createSession(ticketId, title);
      sessionCounter++;
      const session: MockOpenCodeSession = {
        id: `mock-session-${sessionCounter}`,
        title,
        createdAt: new Date(),
        lastMessageAt: new Date(),
      };
      sessions.set(session.id, session);
      return session;
    },

    async getSession(sessionId) {
      return sessions.get(sessionId) ?? null;
    },

    async listSessions() {
      return Array.from(sessions.values()).map(s => ({
        id: s.id,
        title: s.title,
        createdAt: s.createdAt,
        lastMessageAt: s.lastMessageAt,
      }));
    },
  };
}

// =============================================================================
// Telegram Client Mock
// =============================================================================

export interface MockTelegramClient {
  isEnabled(): boolean;
  isGroupMode(): boolean;
  sendToDispatch(
    text: string,
    options?: { parseMode?: string; keyboard?: unknown },
  ): Promise<number | null>;
  sendMessage(
    text: string,
    options?: { parseMode?: string; keyboard?: unknown; topicId?: number; chatId?: string },
  ): Promise<number | null>;
  sendToOrchestratorTopic(
    topicId: number,
    text: string,
    options?: { parseMode?: string; keyboard?: unknown },
  ): Promise<number | null>;
  createForumTopic(
    name: string,
    options?: { iconColor?: number },
  ): Promise<{ message_thread_id: number; name: string } | null>;

  // Test inspection
  _calls: {
    sendToDispatch: Array<{ text: string; options?: { parseMode?: string; keyboard?: unknown } }>;
    sendMessage: Array<{ text: string; options?: { parseMode?: string; keyboard?: unknown; topicId?: number; chatId?: string } }>;
    sendToOrchestratorTopic: Array<{ topicId: number; text: string; options?: { parseMode?: string; keyboard?: unknown } }>;
    createForumTopic: Array<{ name: string; options?: { iconColor?: number } }>;
  };
}

/**
 * Create a mock TelegramClient.
 */
export function mockTelegramClient(overrides?: {
  isEnabled?: boolean;
  isGroupMode?: boolean;
  sendToDispatch?: (text: string, options?: unknown) => Promise<number | null>;
  sendMessage?: (text: string, options?: unknown) => Promise<number | null>;
  sendToOrchestratorTopic?: (topicId: number, text: string, options?: unknown) => Promise<number | null>;
  createForumTopic?: (name: string, options?: unknown) => Promise<{ message_thread_id: number; name: string } | null>;
}): MockTelegramClient {
  const calls: MockTelegramClient["_calls"] = {
    sendToDispatch: [],
    sendMessage: [],
    sendToOrchestratorTopic: [],
    createForumTopic: [],
  };

  return {
    _calls: calls,

    isEnabled() {
      return overrides?.isEnabled ?? true;
    },

    isGroupMode() {
      return overrides?.isGroupMode ?? true;
    },

    async sendToDispatch(text, options) {
      calls.sendToDispatch.push({ text, options });
      if (overrides?.sendToDispatch) return overrides.sendToDispatch(text, options);
      return 1;
    },

    async sendMessage(text, options) {
      calls.sendMessage.push({ text, options });
      if (overrides?.sendMessage) return overrides.sendMessage(text, options);
      return 1;
    },

    async sendToOrchestratorTopic(topicId, text, options) {
      calls.sendToOrchestratorTopic.push({ topicId, text, options });
      if (overrides?.sendToOrchestratorTopic) return overrides.sendToOrchestratorTopic(topicId, text, options);
      return 1;
    },

    async createForumTopic(name, options) {
      calls.createForumTopic.push({ name, options });
      if (overrides?.createForumTopic) return overrides.createForumTopic(name, options);
      return { message_thread_id: 42, name };
    },
  };
}

// =============================================================================
// Messenger Mock
// =============================================================================

export interface MockMessenger extends MessengerOutbound {
  _calls: {
    send: Array<{ channel: MessageChannel; text: string }>;
    sendFormatted: Array<{ channel: MessageChannel; text: string }>;
    createOrchestratorChannel: Array<{ identifier: string; title: string }>;
    hasOrchestratorChannel: string[];
    loadChannelsForSession: string[];
    resolveSessionByChannel: Array<{ provider: string; channelId: string }>;
  };
}

/**
 * Create a mock MessengerOutbound.
 */
export function mockMessenger(overrides?: {
  isEnabled?: boolean;
  createOrchestratorChannel?: (id: string, title: string) => Promise<string | null>;
  hasOrchestratorChannel?: (id: string) => boolean;
  loadChannelsForSession?: (id: string) => Record<string, string>;
  resolveSessionByChannel?: (provider: string, channelId: string) => string | null;
}): MockMessenger {
  const calls: MockMessenger["_calls"] = {
    send: [],
    sendFormatted: [],
    createOrchestratorChannel: [],
    hasOrchestratorChannel: [],
    loadChannelsForSession: [],
    resolveSessionByChannel: [],
  };

  return {
    _calls: calls,

    isEnabled() {
      return overrides?.isEnabled ?? true;
    },

    async send(channel, text) {
      calls.send.push({ channel, text });
    },

    async sendFormatted(channel, text) {
      calls.sendFormatted.push({ channel, text });
    },

    async createOrchestratorChannel(identifier, title) {
      calls.createOrchestratorChannel.push({ identifier, title });
      if (overrides?.createOrchestratorChannel) return overrides.createOrchestratorChannel(identifier, title);
      return "42";
    },

    hasOrchestratorChannel(identifier) {
      calls.hasOrchestratorChannel.push(identifier);
      if (overrides?.hasOrchestratorChannel) return overrides.hasOrchestratorChannel(identifier);
      return false;
    },

    loadChannelsForSession(identifier) {
      calls.loadChannelsForSession.push(identifier);
      if (overrides?.loadChannelsForSession) return overrides.loadChannelsForSession(identifier);
      return {};
    },

    resolveSessionByChannel(provider, channelId) {
      calls.resolveSessionByChannel.push({ provider, channelId });
      if (overrides?.resolveSessionByChannel) return overrides.resolveSessionByChannel(provider, channelId);
      return null;
    },
  };
}

// =============================================================================
// Session Manager Mock
// =============================================================================

export interface MockSessionManager {
  getOrchestratorSessions(): OrchestratorSession[];
  _sessions: OrchestratorSession[];
}

/**
 * Create a mock SessionManager with a fixed set of sessions.
 */
export function mockSessionManager(sessions: OrchestratorSession[] = []): MockSessionManager {
  return {
    _sessions: sessions,
    getOrchestratorSessions() {
      return this._sessions;
    },
  };
}

// =============================================================================
// Fixture helpers
// =============================================================================

/**
 * Create a minimal OrchestratorSession for testing.
 */
export function makeSession(overrides?: Partial<OrchestratorSession>): OrchestratorSession {
  return {
    id: "session-001",
    identifier: "TEAM-1234",
    title: "Test session",
    type: "epic",
    branch: "epic/stay-1234-test",
    status: "active",
    createdAt: new Date().toISOString(),
    lastMessageAt: new Date().toISOString(),
    activePRs: [],
    channels: {},
    ...overrides,
  };
}

/**
 * Insert a session row in the DB (satisfies FK constraints for questions table).
 * Call inside withTestDb() before inserting questions.
 */
export function seedSession(overrides?: Partial<OrchestratorSession>): void {
  const s = makeSession(overrides);
  upsertSession({
    id: s.id,
    identifier: s.identifier,
    title: s.title,
    type: s.type,
    status: s.status,
    branch: s.branch,
    createdAt: s.createdAt,
    lastMessageAt: s.lastMessageAt,
    metadata: {},
  });
}

/**
 * Create a temp file with given content, return its path.
 * Caller is responsible for cleanup.
 */
export async function writeTempFile(content: string, prefix = "munadi-fixture-"): Promise<string> {
  const path = await Deno.makeTempFile({ prefix });
  await Deno.writeTextFile(path, content);
  return path;
}

// =============================================================================
// Intent Resolver Mock
// =============================================================================

import type { ResolvedIntent } from "./daemon/intent-resolver.ts";

export interface MockIntentResolver {
  resolve(text: string, context?: unknown): Promise<ResolvedIntent>;
  _calls: Array<{ text: string; context?: unknown }>;
  _nextResult: ResolvedIntent | null;
}

/**
 * Create a mock IntentResolver.
 * Set `_nextResult` to control what resolve() returns.
 * Default: returns "not_found".
 */
export function mockIntentResolver(): MockIntentResolver {
  const calls: MockIntentResolver["_calls"] = [];
  return {
    _calls: calls,
    _nextResult: null,

    async resolve(text, context) {
      calls.push({ text, context });
      if (this._nextResult) {
        const result = this._nextResult;
        this._nextResult = null;
        return result;
      }
      return {
        status: "not_found",
        rawText: text,
        method: "deterministic_search",
      };
    },
  };
}

// =============================================================================
// Config helper
// =============================================================================

import type { MunadiConfig } from "./types.ts";

/**
 * Create a minimal MunadiConfig for testing.
 * No real Telegram/Linear/OpenCode connections.
 */
export function makeConfig(overrides?: Partial<MunadiConfig>): MunadiConfig {
  return {
    opencode: { server: "http://localhost:4096" },
    quietHours: { start: "00:00", end: "06:00", timezone: "UTC" },
    issueTracker: { provider: "linear", apiKey: "", teamId: "" },
    notifications: {
      telegram: {
        enabled: false,
        botToken: "",
        chatId: "",
        groupId: undefined,
        dispatchTopicId: undefined,
        proxy: undefined,
      },
      ntfy: {
        enabled: false,
        server: "",
        topic: "",
      },
    },
    prompts: {},
    ...overrides,
  } as MunadiConfig;
}
