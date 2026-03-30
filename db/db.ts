/**
 * Munadi State Database (SQLite)
 *
 * Centralized state persistence using SQLite with WAL mode.
 *
 * All state is stored in a single munadi.sqlite file:
 *   ~/.config/iksir/state/munadi.sqlite
 *
 * Tables:
 *   - schema_version: Migration tracking
 *   - sessions: Murshid sessions
 *   - channels: Per-murshid messaging channels (provider → channel_id)
 *   - events: IPC event log (pm channel)
 *   - questions: Pending questions awaiting operator response
 *   - diary_decisions: Per-murshid decision log
 *   - diary_impl_status: Implementation status tracking
 */

import { Database } from "@db/sqlite";
import { join } from "jsr:@std/path";
import { logger } from "../src/logging/logger.ts";

// ---------------------------------------------------------------------------
// Database singleton
// ---------------------------------------------------------------------------

function getStateDir(): string {
  return Deno.env.get("MUNADI_STATE_DIR") ??
    join(Deno.env.get("XDG_DATA_HOME") ?? join(Deno.env.get("HOME") ?? "/root", ".local", "share"), "munadi");
}

let db: Database | null = null;

function getDb(): Database {
  if (!db) {
    throw new Error("Database not tahyiad. Call initDatabase() first.");
  }
  return db;
}

// ---------------------------------------------------------------------------
// Initialization & teardown
// ---------------------------------------------------------------------------

/**
 * Initialize the SQLite database, create tables if needed, enable WAL mode.
 * Must be called once at startup before any other database function.
 * Fully idempotent — safe to call on every restart.
 */
export async function initDatabase(): Promise<void> {
  const stateDir = getStateDir();
  const dbPath = join(stateDir, "munadi.sqlite");

  // Ensure state directory exists
  await Deno.mkdir(stateDir, { recursive: true });

  db = new Database(dbPath);

  // Performance pragmas
  db.exec("PRAGMA journal_mode=WAL");
  db.exec("PRAGMA synchronous=NORMAL");
  db.exec("PRAGMA foreign_keys=ON");

  applySchema(db);

  await logger.info("database", `SQLite tahyiad at ${dbPath}`);
}

/**
 * Create all tables and indexes. Every statement is idempotent
 * (IF NOT EXISTS), so this is safe on first run and every restart.
 */
function applySchema(d: Database): void {
  d.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    )
  `);

  d.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      identifier TEXT NOT NULL,
      title TEXT,
      type TEXT NOT NULL,
      status TEXT NOT NULL,
      branch TEXT,
      blocked_reason TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_message_at TEXT,
      metadata TEXT
    )
  `);

  // NOTE: RisalaMutaba data is stored in sessions.metadata JSON, not a dedicated table.

  d.exec(`
    CREATE TABLE IF NOT EXISTS channels (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_identifier TEXT NOT NULL,
      provider TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      metadata TEXT,
      created_at TEXT NOT NULL,
      UNIQUE(session_identifier, provider)
    )
  `);

  d.exec(`
    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      tool TEXT NOT NULL,
      payload TEXT NOT NULL,
      huwiyat_murshid TEXT,
      processed INTEGER DEFAULT 0,
      created_at TEXT NOT NULL
    )
  `);

  d.exec(`
    CREATE TABLE IF NOT EXISTS questions (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id),
      question TEXT NOT NULL,
      options TEXT,
      answer TEXT,
      telegram_message_id INTEGER,
      created_at TEXT NOT NULL,
      answered_at TEXT
    )
  `);

  d.exec(`
    CREATE TABLE IF NOT EXISTS diary_decisions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      huwiyat_murshid TEXT NOT NULL,
      type TEXT NOT NULL,
      decision TEXT NOT NULL,
      reasoning TEXT NOT NULL,
      metadata TEXT,
      created_at TEXT NOT NULL
    )
  `);

  d.exec(`
    CREATE TABLE IF NOT EXISTS diary_impl_status (
      huwiyat_wasfa TEXT PRIMARY KEY,
      huwiyat_murshid TEXT NOT NULL,
      status TEXT NOT NULL,
      summary TEXT,
      files_changed TEXT,
      updated_at TEXT NOT NULL
    )
  `);

  d.exec(`
    CREATE TABLE IF NOT EXISTS pending_demands (
      huwiyat_murshid TEXT PRIMARY KEY,
      reason TEXT NOT NULL,
      priority TEXT NOT NULL,
      demanded_at TEXT NOT NULL
    )
  `);

  // Indexes
  d.exec(
    "CREATE INDEX IF NOT EXISTS idx_events_unprocessed ON events(processed, type) WHERE processed = 0",
  );
  d.exec("CREATE INDEX IF NOT EXISTS idx_events_created ON events(created_at)");
  d.exec("CREATE INDEX IF NOT EXISTS idx_questions_session ON questions(session_id)");
  d.exec(
    "CREATE INDEX IF NOT EXISTS idx_questions_unanswered ON questions(session_id) WHERE answered_at IS NULL",
  );
  d.exec("CREATE INDEX IF NOT EXISTS idx_diary_murshid ON diary_decisions(huwiyat_murshid)");
  d.exec("CREATE INDEX IF NOT EXISTS idx_channels_lookup ON channels(provider, channel_id)");

  // Mark schema version (for future migrations)
  d.prepare("INSERT OR IGNORE INTO schema_version VALUES (?, ?)").run(
    2,
    new Date().toISOString(),
  );
}

/**
 * Close the database connection. Call during ighlaaq.
 */
export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
  }
}

// ---------------------------------------------------------------------------
// Events (IPC channel)
// ---------------------------------------------------------------------------

/**
 * Insert an IPC event into the events table.
 * Used by MCP servers to forward tool calls to the daemon.
 */
export function insertEvent(
  channel: "pm",
  toolName: string,
  payload: Record<string, unknown>,
  huwiyyatMurshid?: string,
): void {
  const d = getDb();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  d.prepare(
    "INSERT INTO events (id, type, tool, payload, huwiyat_murshid, processed, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)",
  ).run(id, channel, toolName, JSON.stringify(payload), huwiyyatMurshid ?? null, now);
}

/**
 * Get all unprocessed events for a given channel, ordered by creation time.
 * Returns objects with { id, payload } where payload is a JSON string.
 */
export function getUnprocessedEvents(
  channel: "pm",
): Array<{ id: number; payload: string }> {
  const d = getDb();

  // Note: callers expect `id` as number but our schema uses TEXT UUIDs.
  // The callers only pass id back to markEventProcessed, so we return rowid
  // alongside payload for compatibility. Actually, looking at the callers:
  //   dbEvent.id is passed to markEventProcessed(dbEvent.id)
  //   dbEvent.payload is JSON.parse'd
  // We use the TEXT id (UUID) since that's the primary key.
  const rows = d
    .prepare(
      "SELECT id, payload FROM events WHERE processed = 0 AND type = ? ORDER BY created_at ASC",
    )
    .all(channel) as Array<{ id: string; payload: string }>;

  // Callers use dbEvent.id with markEventProcessed — it accepts string|number.
  // Return as-is; the id is a UUID string.
  return rows as unknown as Array<{ id: number; payload: string }>;
}

/**
 * Mark an event as processed by its ID.
 */
export function markEventProcessed(eventId: number | string): void {
  const d = getDb();
  d.prepare("UPDATE events SET processed = 1 WHERE id = ?").run(String(eventId));
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

interface UpsertSessionArgs {
  id: string;
  identifier: string;
  title: string;
  type: string;
  status: string;
  branch: string;
  blockedReason?: string;
  createdAt: string;
  lastMessageAt: string;
  metadata: Record<string, unknown>;
}

/**
 * Upsert an murshid session. Creates or updates by primary key (id).
 * Channel state is persisted separately via upsertChannel().
 */
export function upsertSession(args: UpsertSessionArgs): void {
  const d = getDb();
  d.prepare(`
    INSERT INTO sessions (id, identifier, title, type, status, branch, blocked_reason, created_at, updated_at, last_message_at, metadata)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      identifier = excluded.identifier,
      title = excluded.title,
      type = excluded.type,
      status = excluded.status,
      branch = excluded.branch,
      blocked_reason = excluded.blocked_reason,
      updated_at = excluded.updated_at,
      last_message_at = excluded.last_message_at,
      metadata = excluded.metadata
  `).run(
    args.id,
    args.identifier,
    args.title,
    args.type,
    args.status,
    args.branch,
    args.blockedReason ?? null,
    args.createdAt,
    new Date().toISOString(),
    args.lastMessageAt,
    JSON.stringify(args.metadata),
  );
}

interface DbSession {
  id: string;
  identifier: string;
  title: string;
  type: string;
  status: string;
  branch: string | null;
  blocked_reason: string | null;
  created_at: string;
  last_message_at: string;
  metadata: string | null;
}

/**
 * Get all murshid sessions from the database.
 */
export function getAllSessions(): DbSession[] {
  const d = getDb();
  return d.prepare("SELECT id, identifier, title, type, status, branch, blocked_reason, created_at, last_message_at, metadata FROM sessions").all() as DbSession[];
}

// ---------------------------------------------------------------------------
// Channels (messaging abstraction)
// ---------------------------------------------------------------------------

/**
 * Upsert a channel for an murshid. One channel per provider per session.
 */
export function upsertChannel(
  sessionIdentifier: string,
  provider: string,
  channelId: string,
  metadata?: Record<string, unknown>,
): void {
  const d = getDb();
  d.prepare(`
    INSERT INTO channels (session_identifier, provider, channel_id, metadata, created_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(session_identifier, provider) DO UPDATE SET
      channel_id = excluded.channel_id,
      metadata = excluded.metadata
  `).run(
    sessionIdentifier,
    provider,
    channelId,
    metadata ? JSON.stringify(metadata) : null,
    new Date().toISOString(),
  );
}

/**
 * Get channel ID for an murshid + provider, or null if none.
 */
export function getChannel(
  sessionIdentifier: string,
  provider: string,
): string | null {
  const d = getDb();
  const row = d
    .prepare("SELECT channel_id FROM channels WHERE session_identifier = ? AND provider = ?")
    .get(sessionIdentifier, provider) as { channel_id: string } | undefined;
  return row?.channel_id ?? null;
}

/**
 * Get all channels for an murshid as a Record<provider, channelId>.
 */
export function getChannelsForSession(
  sessionIdentifier: string,
): Record<string, string> {
  const d = getDb();
  const rows = d
    .prepare("SELECT provider, channel_id FROM channels WHERE session_identifier = ?")
    .all(sessionIdentifier) as Array<{ provider: string; channel_id: string }>;

  const result: Record<string, string> = {};
  for (const row of rows) {
    result[row.provider] = row.channel_id;
  }
  return result;
}

/**
 * Reverse lookup: find session identifier by provider + channel ID.
 * Used for inbound message routing (e.g., Telegram topic → murshid).
 */
export function jalabJalsaByChannel(
  provider: string,
  channelId: string,
): string | null {
  const d = getDb();
  const row = d
    .prepare("SELECT session_identifier FROM channels WHERE provider = ? AND channel_id = ?")
    .get(provider, channelId) as { session_identifier: string } | undefined;
  return row?.session_identifier ?? null;
}

/**
 * Delete a channel for an murshid.
 */
export function mahaqaQanat(
  sessionIdentifier: string,
  provider: string,
): void {
  const d = getDb();
  d.prepare("DELETE FROM channels WHERE session_identifier = ? AND provider = ?")
    .run(sessionIdentifier, provider);
}

// ---------------------------------------------------------------------------
// Questions
// ---------------------------------------------------------------------------

interface InsertQuestionArgs {
  id: string;
  sessionId: string;
  question: string;
  options: string[];
  telegramMessageId?: number;
}

/**
 * Insert a pending question into the database.
 */
export function insertQuestion(args: InsertQuestionArgs): void {
  const d = getDb();
  d.prepare(`
    INSERT OR IGNORE INTO questions (id, session_id, question, options, telegram_message_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    args.id,
    args.sessionId,
    args.question,
    JSON.stringify(args.options),
    args.telegramMessageId ?? null,
    new Date().toISOString(),
  );
}

interface DbUnansweredQuestion {
  id: string;
  session_id: string;
  question: string;
  options: string | null;
  telegram_message_id: number | null;
  created_at: string;
}

/**
 * Get all unanswered questions.
 */
export function getUnansweredQuestions(): DbUnansweredQuestion[] {
  const d = getDb();
  return d
    .prepare(
      "SELECT id, session_id, question, options, telegram_message_id, created_at FROM questions WHERE answered_at IS NULL",
    )
    .all() as DbUnansweredQuestion[];
}

/**
 * Mark a question as answered in the database.
 */
export function markQuestionAnswered(questionId: string, answer: string): void {
  const d = getDb();
  d.prepare(
    "UPDATE questions SET answer = ?, answered_at = ? WHERE id = ?",
  ).run(answer, new Date().toISOString(), questionId);
}

/**
 * Update the telegram_message_id for a question (set after sending to Telegram).
 */
export function updateQuestionTelegramMessageId(questionId: string, messageId: number): void {
  const d = getDb();
  d.prepare(
    "UPDATE questions SET telegram_message_id = ? WHERE id = ?",
  ).run(messageId, questionId);
}

// ---------------------------------------------------------------------------
// Diary — decisions
// ---------------------------------------------------------------------------

interface AddQararSijillArgs {
  huwiyyatMurshid: string;
  type: string;
  decision: string;
  reasoning: string;
  metadata?: Record<string, unknown>;
}

/**
 * Append a decision to the diary log.
 */
export function addQararSijill(args: AddQararSijillArgs): void {
  const d = getDb();
  d.prepare(`
    INSERT INTO diary_decisions (huwiyat_murshid, type, decision, reasoning, metadata, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    args.huwiyyatMurshid,
    args.type,
    args.decision,
    args.reasoning,
    args.metadata ? JSON.stringify(args.metadata) : null,
    new Date().toISOString(),
  );
}

// ---------------------------------------------------------------------------
// Diary — query decisions (collective knowledge pool)
// ---------------------------------------------------------------------------

interface KhiyaratJalabQararatSijill {
  huwiyyatMurshid?: string;  // filter by murshid (omit for collective)
  type?: string;            // filter by decision type
  search?: string;          // free-text search in decision + reasoning
  limit?: number;           // default 20
  since?: string;           // ISO date cutoff
}

interface QararSijillDb {
  id: number;
  huwiyat_murshid: string;
  type: string;
  decision: string;
  reasoning: string;
  metadata: string | null;
  created_at: string;
}

/**
 * Query diary decisions. Returns most recent first.
 * Supports filtering by murshid, type, and free-text search.
 */
export function getQararSijills(opts: KhiyaratJalabQararatSijill = {}): QararSijillDb[] {
  const d = getDb();
  const conditions: string[] = [];
  const params: (string | number | null)[] = [];

  if (opts.huwiyyatMurshid) {
    conditions.push("huwiyat_murshid = ?");
    params.push(opts.huwiyyatMurshid);
  }
  if (opts.type) {
    conditions.push("type = ?");
    params.push(opts.type);
  }
  if (opts.since) {
    conditions.push("created_at >= ?");
    params.push(opts.since);
  }
  if (opts.search) {
    conditions.push("(decision LIKE ? OR reasoning LIKE ?)");
    const pattern = `%${opts.search}%`;
    params.push(pattern, pattern);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = opts.limit ?? 20;
  params.push(limit);

  return d.prepare(
    `SELECT id, huwiyat_murshid, type, decision, reasoning, metadata, created_at
     FROM diary_decisions ${where}
     ORDER BY created_at DESC
     LIMIT ?`
  ).all(...params) as QararSijillDb[];
}

// ---------------------------------------------------------------------------
// Diary — implementation status
// ---------------------------------------------------------------------------

interface UpsertImplStatusArgs {
  huwiyyatWasfa: string;
  huwiyyatMurshid: string;
  status: string;
  summary?: string;
}

/**
 * Upsert implementation status for a formula.
 */
export function naqshStatus(args: UpsertImplStatusArgs): void {
  const d = getDb();
  d.prepare(`
    INSERT INTO diary_impl_status (huwiyat_wasfa, huwiyat_murshid, status, summary, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(huwiyat_wasfa) DO UPDATE SET
      huwiyat_murshid = excluded.huwiyat_murshid,
      status = excluded.status,
      summary = excluded.summary,
      updated_at = excluded.updated_at
  `).run(
    args.huwiyyatWasfa,
    args.huwiyyatMurshid,
    args.status,
    args.summary ?? null,
    new Date().toISOString(),
  );
}

interface DbImplStatus {
  status: string;
  huwiyat_murshid: string;
  summary: string | null;
}

/**
 * Get implementation status for a formula, or null if not found.
 */
export function qiraStatus(huwiyyatWasfa: string): DbImplStatus | null {
  const d = getDb();
  const row = d
    .prepare(
      "SELECT status, huwiyat_murshid, summary FROM diary_impl_status WHERE huwiyat_wasfa = ?",
    )
    .get(huwiyyatWasfa) as DbImplStatus | undefined;

  return row ?? null;
}

// ---------------------------------------------------------------------------
// Pending Demands (control handover)
// ---------------------------------------------------------------------------

interface PendingDemand {
  huwiyat_murshid: string;
  reason: string;
  priority: string;
  demanded_at: string;
}

/**
 * Upsert a pending demand (one per murshid).
 */
export function upsertPendingDemand(
  huwiyyatMurshid: string,
  reason: string,
  priority: "normal" | "urgent",
): void {
  const d = getDb();
  d.prepare(`
    INSERT INTO pending_demands (huwiyat_murshid, reason, priority, demanded_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(huwiyat_murshid) DO UPDATE SET
      reason = excluded.reason,
      priority = excluded.priority,
      demanded_at = excluded.demanded_at
  `).run(huwiyyatMurshid, reason, priority, new Date().toISOString());
}

/**
 * Remove a pending demand (after it's been fulfilled).
 */
export function removePendingDemand(huwiyyatMurshid: string): void {
  const d = getDb();
  d.prepare("DELETE FROM pending_demands WHERE huwiyat_murshid = ?").run(huwiyyatMurshid);
}

/**
 * Get all pending demands, sorted by priority (urgent first) then time.
 */
export function getPendingDemands(): PendingDemand[] {
  const d = getDb();
  return d.prepare(
    `SELECT huwiyat_murshid, reason, priority, demanded_at
     FROM pending_demands
     ORDER BY
       CASE priority WHEN 'urgent' THEN 0 ELSE 1 END,
       demanded_at ASC`
  ).all() as PendingDemand[];
}


