/**
 * Shared Test Helpers
 *
 * Mock factories and utilities for Tier 2+ tests.
 * Provides typed mocks for OpenCodeClient, TelegramClient, RasulKharij,
 * and MudirJalasat. Uses real temp DB instances (same pattern as db_test.ts).
 */

import { baddaaQaidatBayanat, aghlaaqQaidatBayanat, haddathaAwAdkhalaJalsa } from "../db/db.ts";
import { execCommand } from "./utils/exec.ts";
import type { RasulKharij, QanatRisala, JalsatMurshid, JawabSual } from "./types.ts";
import { DEFAULT_OPENCODE_SERVER } from "./constants.ts";


/**
 * Run a test function with an isolated temp SQLite DB.
 * Sets IKSIR_STATE_DIR, tahyias DB, runs fn, then cleans up.
 */
export async function withTestDb(fn: () => Promise<void> | void): Promise<void> {
  const tempDir = await Deno.makeTempDir({ prefix: "iksir-test-" });
  Deno.env.set("IKSIR_STATE_DIR", tempDir);
  try {
    await baddaaQaidatBayanat();
    await fn();
  } finally {
    aghlaaqQaidatBayanat();
    Deno.env.delete("IKSIR_STATE_DIR");
    await Deno.remove(tempDir, { recursive: true });
  }
}

/**
 * Run a test function with both an isolated DB and an isolated git repo.
 * Creates a temp dir with `git init`, sets IKSIR_REPO_PATH + IKSIR_STATE_DIR,
 * tahyias DB, runs fn, then cleans up everything.
 *
 * Use this for tests that exercise code paths involving git operations
 * (e.g. dispatcher → session-manager → git intaqalaIla).
 */
export async function withTestRepo(fn: () => Promise<void> | void): Promise<void> {
  const tempDir = await Deno.makeTempDir({ prefix: "iksir-repo-test-" });
  const prevRepo = Deno.env.get("IKSIR_REPO_PATH");
  Deno.env.set("IKSIR_REPO_PATH", tempDir);
  Deno.env.set("IKSIR_STATE_DIR", tempDir);
  try {
    await execCommand("git", ["init"], { cwd: tempDir });
    await execCommand("git", ["commit", "--allow-empty", "-m", "init"], { cwd: tempDir });
    await baddaaQaidatBayanat();
    await fn();
  } finally {
    aghlaaqQaidatBayanat();
    Deno.env.delete("IKSIR_STATE_DIR");
    if (prevRepo) Deno.env.set("IKSIR_REPO_PATH", prevRepo);
    else Deno.env.delete("IKSIR_REPO_PATH");
    await Deno.remove(tempDir, { recursive: true });
  }
}


/** Minimal session shape returned by OpenCode mock */
interface MockJalsatOpenCode {
  id: string;
  title: string;
  createdAt: Date;
  lastMessageAt: Date;
}

export interface MockOpenCodeClient {
  mayyaza(prompt: string): Promise<{ success: boolean; response?: string; error?: string }>;
  replyToQuestion(
    sessionId: string,
    questionId: string,
    answers: JawabSual[],
  ): Promise<boolean>;
  rejectQuestion(sessionId: string, questionId: string): Promise<boolean>;
  sendPromptAsync(sessionId: string, prompt: string, options?: unknown): Promise<boolean>;
  sendPrompt(
    sessionId: string,
    prompt: string,
    options?: unknown,
  ): Promise<{ success: boolean; response?: string; error?: string }>;
  khalaqaJalsa(huwiyyatWasfa: string, title: string): Promise<MockJalsatOpenCode | null>;
  jalabJalsa(sessionId: string): Promise<MockJalsatOpenCode | null>;
  listSessions(): Promise<Array<{ id: string; title: string; createdAt: Date; lastMessageAt: Date }>>;

  _calls: {
    mayyaza: string[];
    replyToQuestion: Array<{ sessionId: string; questionId: string; answers: JawabSual[] }>;
    rejectQuestion: Array<{ sessionId: string; questionId: string }>;
    sendPromptAsync: Array<{ sessionId: string; prompt: string }>;
    sendPrompt: Array<{ sessionId: string; prompt: string }>;
    khalaqaJalsa: Array<{ huwiyyatWasfa: string; title: string }>;
  };
  _sessions: Map<string, MockJalsatOpenCode>;
}

/**
 * Create a mock OpenCodeClient. Override specific methods via the overrides param.
 * Includes session management (khalaqaJalsa, jalabJalsa) for integration tests.
 */
export function mockOpenCodeClient(overrides?: {
  mayyaza?: (prompt: string) => Promise<{ success: boolean; response?: string; error?: string }>;
  replyToQuestion?: (
    sessionId: string,
    questionId: string,
    answers: JawabSual[],
  ) => Promise<boolean>;
  rejectQuestion?: (sessionId: string, questionId: string) => Promise<boolean>;
  sendPromptAsync?: (sessionId: string, prompt: string) => Promise<boolean>;
  sendPrompt?: (sessionId: string, prompt: string) => Promise<{ success: boolean; response?: string; error?: string }>;
  khalaqaJalsa?: (huwiyyatWasfa: string, title: string) => Promise<MockJalsatOpenCode | null>;
}): MockOpenCodeClient {
  const calls: MockOpenCodeClient["_calls"] = {
    mayyaza: [],
    replyToQuestion: [],
    rejectQuestion: [],
    sendPromptAsync: [],
    sendPrompt: [],
    khalaqaJalsa: [],
  };

  const sessions = new Map<string, MockJalsatOpenCode>();
  let sessionCounter = 0;

  return {
    _calls: calls,
    _sessions: sessions,

    async mayyaza(prompt: string) {
      calls.mayyaza.push(prompt);
      if (overrides?.mayyaza) return overrides.mayyaza(prompt);
      return { success: true, response: '{"tamyiz":"DHAHAB","reason":"test","rejection":null}' };
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

    async khalaqaJalsa(huwiyyatWasfa, title) {
      calls.khalaqaJalsa.push({ huwiyyatWasfa, title });
      if (overrides?.khalaqaJalsa) return overrides.khalaqaJalsa(huwiyyatWasfa, title);
      sessionCounter++;
      const session: MockJalsatOpenCode = {
        id: `mock-session-${sessionCounter}`,
        title,
        createdAt: new Date(),
        lastMessageAt: new Date(),
      };
      sessions.set(session.id, session);
      return session;
    },

    async jalabJalsa(sessionId) {
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


export interface MockTelegramClient {
  mumakkan(): boolean;
  isGroupMode(): boolean;
  sendToDispatch(
    text: string,
    options?: { parseMode?: string; keyboard?: unknown },
  ): Promise<number | null>;
  arsalaRisala(
    text: string,
    options?: { parseMode?: string; keyboard?: unknown; topicId?: number; chatId?: string },
  ): Promise<number | null>;
  arsalaIlaMurshidTopic(
    topicId: number,
    text: string,
    options?: { parseMode?: string; keyboard?: unknown },
  ): Promise<number | null>;
  createForumTopic(
    name: string,
    options?: { iconColor?: number },
  ): Promise<{ message_thread_id: number; name: string } | null>;

  _calls: {
    sendToDispatch: Array<{ text: string; options?: { parseMode?: string; keyboard?: unknown } }>;
    arsalaRisala: Array<{ text: string; options?: { parseMode?: string; keyboard?: unknown; topicId?: number; chatId?: string } }>;
    arsalaIlaMurshidTopic: Array<{ topicId: number; text: string; options?: { parseMode?: string; keyboard?: unknown } }>;
    createForumTopic: Array<{ name: string; options?: { iconColor?: number } }>;
  };
}

/**
 * Create a mock TelegramClient.
 */
export function mockTelegramClient(overrides?: {
  mumakkan?: boolean;
  isGroupMode?: boolean;
  sendToDispatch?: (text: string, options?: unknown) => Promise<number | null>;
  arsalaRisala?: (text: string, options?: unknown) => Promise<number | null>;
  arsalaIlaMurshidTopic?: (topicId: number, text: string, options?: unknown) => Promise<number | null>;
  createForumTopic?: (name: string, options?: unknown) => Promise<{ message_thread_id: number; name: string } | null>;
}): MockTelegramClient {
  const calls: MockTelegramClient["_calls"] = {
    sendToDispatch: [],
    arsalaRisala: [],
    arsalaIlaMurshidTopic: [],
    createForumTopic: [],
  };

  return {
    _calls: calls,

    mumakkan() {
      return overrides?.mumakkan ?? true;
    },

    isGroupMode() {
      return overrides?.isGroupMode ?? true;
    },

    async sendToDispatch(text, options) {
      calls.sendToDispatch.push({ text, options });
      if (overrides?.sendToDispatch) return overrides.sendToDispatch(text, options);
      return 1;
    },

    async arsalaRisala(text, options) {
      calls.arsalaRisala.push({ text, options });
      if (overrides?.arsalaRisala) return overrides.arsalaRisala(text, options);
      return 1;
    },

    async arsalaIlaMurshidTopic(topicId, text, options) {
      calls.arsalaIlaMurshidTopic.push({ topicId, text, options });
      if (overrides?.arsalaIlaMurshidTopic) return overrides.arsalaIlaMurshidTopic(topicId, text, options);
      return 1;
    },

    async createForumTopic(name, options) {
      calls.createForumTopic.push({ name, options });
      if (overrides?.createForumTopic) return overrides.createForumTopic(name, options);
      return { message_thread_id: 42, name };
    },
  };
}


export interface MockMessenger extends RasulKharij {
  _calls: {
    send: Array<{ channel: QanatRisala; text: string }>;
    arsalaMunassaq: Array<{ channel: QanatRisala; text: string }>;
    khalaqaQanatMurshid: Array<{ identifier: string; title: string }>;
    yamlikQanatMurshid: string[];
    hammalQanawatLilJalsa: string[];
    hallJalsaBilQanat: Array<{ provider: string; channelId: string }>;
  };
}

/**
 * Create a mock RasulKharij.
 */
export function mockMessenger(overrides?: {
  mumakkan?: boolean;
  khalaqaQanatMurshid?: (id: string, title: string) => Promise<string | null>;
  yamlikQanatMurshid?: (id: string) => boolean;
  hammalQanawatLilJalsa?: (id: string) => Record<string, string>;
  hallJalsaBilQanat?: (provider: string, channelId: string) => string | null;
}): MockMessenger {
  const calls: MockMessenger["_calls"] = {
    send: [],
    arsalaMunassaq: [],
    khalaqaQanatMurshid: [],
    yamlikQanatMurshid: [],
    hammalQanawatLilJalsa: [],
    hallJalsaBilQanat: [],
  };

  return {
    _calls: calls,

    mumakkan() {
      return overrides?.mumakkan ?? true;
    },

    async send(channel, text) {
      calls.send.push({ channel, text });
    },

    async arsalaMunassaq(channel, text) {
      calls.arsalaMunassaq.push({ channel, text });
    },

    async khalaqaQanatMurshid(identifier, title) {
      calls.khalaqaQanatMurshid.push({ identifier, title });
      if (overrides?.khalaqaQanatMurshid) return overrides.khalaqaQanatMurshid(identifier, title);
      return "42";
    },

    yamlikQanatMurshid(identifier) {
      calls.yamlikQanatMurshid.push(identifier);
      if (overrides?.yamlikQanatMurshid) return overrides.yamlikQanatMurshid(identifier);
      return false;
    },

    hammalQanawatLilJalsa(identifier) {
      calls.hammalQanawatLilJalsa.push(identifier);
      if (overrides?.hammalQanawatLilJalsa) return overrides.hammalQanawatLilJalsa(identifier);
      return {};
    },

    hallJalsaBilQanat(provider, channelId) {
      calls.hallJalsaBilQanat.push({ provider, channelId });
      if (overrides?.hallJalsaBilQanat) return overrides.hallJalsaBilQanat(provider, channelId);
      return null;
    },
  };
}


export interface MockMudirJalasat {
  wajadaJalasatMurshid(): JalsatMurshid[];
  _sessions: JalsatMurshid[];
}

/**
 * Create a mock MudirJalasat with a fixed set of sessions.
 */
export function mockMudirJalasat(sessions: JalsatMurshid[] = []): MockMudirJalasat {
  return {
    _sessions: sessions,
    wajadaJalasatMurshid() {
      return this._sessions;
    },
  };
}


/**
 * Create a minimal JalsatMurshid for testing.
 */
export function makeSession(overrides?: Partial<JalsatMurshid>): JalsatMurshid {
  return {
    id: "session-001",
    huwiyya: "TEAM-1234",
    unwan: "Test session",
    naw: "epic",
    far: "epic/stay-1234-test",
    hala: "fail",
    unshiaFi: new Date().toISOString(),
    akhirRisalaFi: new Date().toISOString(),
    activePRs: [],
    channels: {},
    ...overrides,
  };
}

/**
 * Insert a session row in the DB (satisfies FK constraints for questions table).
 * Call inside withTestDb() before inserting questions.
 */
export function seedSession(overrides?: Partial<JalsatMurshid>): void {
  const s = makeSession(overrides);
  haddathaAwAdkhalaJalsa({
    id: s.id,
    huwiyya: s.huwiyya,
    unwan: s.unwan,
    naw: s.naw,
    hala: s.hala,
    far: s.far,
    unshiaFi: s.unshiaFi,
    akhirRisalaFi: s.akhirRisalaFi,
    halaMufassala: {},
  });
}

/**
 * Create a temp file with given content, return its path.
 * Caller is responsible for cleanup.
 */
export async function writeTempFile(content: string, prefix = "iksir-fixture-"): Promise<string> {
  const path = await Deno.makeTempFile({ prefix });
  await Deno.writeTextFile(path, content);
  return path;
}


import type { NiyyaMuhallala } from "./daemon/arraf.ts";

export interface MockArraf {
  halla(text: string, context?: unknown): Promise<NiyyaMuhallala>;
  _calls: Array<{ text: string; context?: unknown }>;
  _nextResult: NiyyaMuhallala | null;
}

/**
 * Create a mock Arraf.
 * Set `_nextResult` to control what resolve() returns.
 * Default: returns "not_found".
 */
export function mockArraf(): MockArraf {
  const calls: MockArraf["_calls"] = [];
  return {
    _calls: calls,
    _nextResult: null,

    async halla(text, context) {
      calls.push({ text, context });
      if (this._nextResult) {
        const result = this._nextResult;
        this._nextResult = null;
        return result;
      }
      return {
        hala: "not_found",
        nassKham: text,
        tariqa: "deterministic_search",
      };
    },
  };
}


import type { TasmimIksir } from "./types.ts";

/**
 * Create a minimal TasmimIksir for testing.
 * No real Telegram/Linear/OpenCode connections.
 */
export function makeConfig(overrides?: Partial<TasmimIksir>): TasmimIksir {
  return {
    opencode: { server: DEFAULT_OPENCODE_SERVER },
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
  } as TasmimIksir;
}
