/**
 * Munadi Core Types
 *
 * Type definitions for the Munadi autonomous agent orchestration system.
 */

// =============================================================================
// Configuration
// =============================================================================

export interface TasmimIksir {
  polling: TasmimIstiftaa;
  quietHours: TasmimSaatSukun;
  notifications: TasmimIsharat;
  issueTracker: MutabiWasfaConfig;
  github: TasmimGitHub;
  opencode: TasmimOpenCode;
  prompts: PromptsConfig;
}

export interface TasmimIstiftaa {
  defaultIntervalMs: number;
  /** Minimum interval between polls of the same PR (ms). Default: 60000 */
  prPollIntervalMs: number;
}

export interface TasmimSaatSukun {
  enabled: boolean;
  start: string; // "22:00"
  end: string; // "07:00"
  timezone: string;
  blockersPassthrough: boolean;
  /** How many minutes before quiet hours end to run maintenance. Default: 60 */
  maintenanceWindowMinutes: number;
}

export interface TasmimIsharat {
  ntfy: NtfyConfig;
  telegram: TasmimTelegram;
}

export interface NtfyConfig {
  enabled: boolean;
  topic: string;
  server: string;
}

export interface TasmimTelegram {
  enabled: boolean;
  botToken: string;
  chatId: string;
  /** Forum-enabled supergroup for Munadi operations */
  groupId?: string;
  /** Dispatch topic ID in the group (for spawning orchestrators) */
  dispatchTopicId?: number;
  /** SOCKS5 proxy URL (e.g., "socks5://localhost:1080") */
  proxy?: string;
}

export interface MutabiWasfaConfig {
  /** Provider name: "linear" | "jira" | "github" */
  provider?: string;
  apiKey: string;
  teamId: string;
  /** Regex pattern for ticket identifiers. Default: "[A-Z]+-\\d+" */
  ticketPattern?: string;
}

// =============================================================================
// Issue Tracker Interface (provider-agnostic)
// =============================================================================

export type NawKiyan = "ticket" | "epic" | "milestone" | "project" | "unknown";

export interface WasfaMutaba {
  id: string;
  identifier: string;
  title: string;
  description?: string;
  status?: string;
  url?: string;
  parentId?: string;
  parent?: { identifier: string; title: string };
  labels?: string[];
  estimate?: number;
}

export interface TrackerProject {
  id: string;
  name: string;
  description?: string;
  url?: string;
  issueCount?: number;
}

export interface TrackerMilestone {
  id: string;
  name: string;
  url?: string;
  startsAt?: string;
  endsAt?: string;
}

export interface ParsedTicketUrl {
  type: NawKiyan;
  id: string;
}

export interface CreateIssueInput {
  title: string;
  description?: string;
  estimate?: number;
  status?: string;
  labels?: string[];
  parentId?: string;
}

export interface UpdateIssueInput {
  title?: string;
  description?: string;
  estimate?: number;
  status?: string;
}

export interface IssueFilters {
  assigneeId?: string;
  status?: string;
  cycleId?: string;
}

export interface MutabiWasfa {
  readonly provider: string;
  isAuthenticated(): Promise<boolean>;

  // Read
  getIssue(identifier: string): Promise<WasfaMutaba | null>;
  getProject(id: string): Promise<TrackerProject | null>;
  searchIssues(query: string, limit?: number): Promise<WasfaMutaba[]>;
  searchProjects(query: string): Promise<TrackerProject[]>;

  // Write
  createIssue(input: CreateIssueInput): Promise<WasfaMutaba>;
  updateIssue(id: string, input: UpdateIssueInput): Promise<WasfaMutaba>;
  setRelations(identifier: string, blocks?: string[], blockedBy?: string[]): Promise<void>;

  // URL handling
  parseUrl(url: string): ParsedTicketUrl | null;
  getUrlPattern(): RegExp;

  // Workflow states
  getStateId(name: string): Promise<string | null>;

  // Search (optional — not all providers have these)
  searchMilestones?(query: string): Promise<TrackerMilestone[]>;
  getActiveMilestone?(): Promise<TrackerMilestone | null>;
  getFilteredIssues?(filters: IssueFilters, limit?: number): Promise<WasfaMutaba[]>;
}

export interface TasmimGitHub {
  owner: string;
  repo: string;
  operatorUsername: string;
}

export interface TasmimOpenCode {
  server: string;
}

export interface PromptsConfig {
  /** Path to notification classification prompt template */
  classifyNotification?: string;
  /** Path to question classification prompt template */
  classifyQuestion?: string;
}

// =============================================================================
// Notifications
// =============================================================================

export type NotificationPriority = "min" | "low" | "default" | "high" | "urgent";

export type NotificationCategory =
  | "blocker"
  | "decision"
  | "progress"
  | "pr_ready"
  | "review_comments"
  | "milestone"
  | "external_change"
  | "quiet_hours_exit";

export interface Notification {
  category: NotificationCategory;
  title: string;
  body: string;
  priority: NotificationPriority;
  actions?: NotificationAction[];
  url?: string;
  projectId?: string;
  huwiyyatWasfa?: string;
}

export interface NotificationAction {
  label: string;
  action: string; // Callback identifier
  url?: string; // For HTTP action buttons
}

// =============================================================================
// Review Comments
// =============================================================================

export interface ReviewComment {
  id: string;
  raqamRisala: number;
  author: string;
  body: string;
  path?: string;
  line?: number;
  createdAt: Date;
  isOperator: boolean;
  assessment: CommentAssessment;
}

export interface CommentAssessment {
  isCommand: boolean;
  intent: "command" | "suggestion" | "question" | "praise" | "concern" | "neutral";
  confidence: number; // 0-1
  reasoning: string;
}

// =============================================================================
// Events & Logging
// =============================================================================

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
  timestamp: Date;
  level: LogLevel;
  category: string;
  message: string;
  context?: Record<string, unknown>;
}

export interface DecisionLogEntry extends LogEntry {
  event: string;
  interpretation: string;
  action: string;
  reasoning: string;
}

export interface ExternalChangeEntry extends LogEntry {
  source: "linear" | "github" | "figma" | "notion";
  entityType: string;
  entityId: string;
  author: string;
  changes: Record<string, { before: unknown; after: unknown }>;
  impact: string;
}

// =============================================================================
// OpenCode Integration
// =============================================================================

export interface JalsatOpenCode {
  id: string;
  projectId: string;
  huwiyyatWasfa: string;
  title: string;
  status: "fail" | "sakin" | "error";
  createdAt: Date;
  lastMessageAt: Date;
}

export interface HadathOpenCode {
  type: string;
  properties: Record<string, unknown>;
  timestamp: Date;
}

// =============================================================================
// Question Tool Events (from OpenCode SSE)
// =============================================================================

/** A single question option */
export interface QuestionOption {
  label: string;
  description: string;
}

/** A single question in a question request */
export interface QuestionInfo {
  /** Very short label (max 30 chars) */
  header: string;
  /** The full question text */
  question: string;
  /** Available choices */
  options: QuestionOption[];
  /** Allow selecting multiple choices */
  multiple?: boolean;
  /** Allow custom text answer (default true) */
  custom?: boolean;
}

/** A question.asked event from OpenCode SSE */
export interface QuestionAskedEvent {
  type: "question.asked";
  properties: {
    /** Unique question request ID */
    id: string;
    /** Session that asked the question */
    sessionID: string;
    /** The questions being asked */
    questions: QuestionInfo[];
    /** Tool context if from a tool call */
    tool?: {
      messageID: string;
      callID: string;
    };
  };
}

/** An answer to a question */
export interface QuestionAnswer {
  /** Index of the question in the questions array */
  questionIndex: number;
  /** Selected option labels */
  selected: string[];
  /** Custom text answer if provided */
  custom?: string;
}

/** Classification result for a question */
export interface QuestionClassification {
  classification: "WORTHY" | "CRY_BABY";
  reason: string;
  /** Terse guidance if CRY_BABY */
  rejection: string | null;
  /** Label of option to auto-select if CRY_BABY */
  autoAnswer: string | null;
}

/** Pending question state */
export interface PendingQuestion {
  id: string;
  sessionID: string;
  huwiyyatMurshid: string;
  questions: QuestionInfo[];
  telegramMessageId?: number;
  createdAt: string;
}

// =============================================================================
// MUN-MCP Tool Calls
// =============================================================================

/**
 * Tool calls made by orchestrators via MUN-MCP.
 * These are dispatched by the daemon's tool executor.
 */

/** Create a new ticket */
export interface NidaKhalqWasfa {
  tool: "mun_create_wasfa";
  huwiyyatMurshid: string;
  title: string;
  description?: string;
  estimate?: number;
  status?: "triage" | "backlog";
  labels?: string[];
  parentId?: string;
}

/** Update an existing ticket */
export interface NidaTajdidWasfa {
  tool: "mun_update_wasfa";
  huwiyyatMurshid: string;
  huwiyyatWasfa: string;
  updates: {
    title?: string;
    description?: string;
    estimate?: number;
    status?: string;
  };
}

/** Set blocking relations between tickets */
export interface MunSetRelationsCall {
  tool: "mun_set_relations";
  huwiyyatMurshid: string;
  huwiyyatWasfa: string;
  blocks?: string[];
  blockedBy?: string[];
}

/** Read any issue tracker URL — returns enriched info with context */
export interface NidaQiraatWasfa {
  tool: "mun_read_wasfa";
  huwiyyatMurshid: string;
  url: string;
}

/** Slice files for a PR */
export interface MunSliceForPrCall {
  tool: "mun_slice_for_pr";
  huwiyyatMurshid: string;
  huwiyyatWasfa: string;
  files: string[];
}

/** Create a draft PR */
export interface NidaKhalqRisala {
  tool: "mun_create_risala";
  huwiyyatMurshid: string;
  huwiyyatWasfa: string;
  title: string;
  body: string;
  base: string;
  head: string;
}

/** Check branch status (ahead/behind) */
export interface MunCheckBranchStatusCall {
  tool: "mun_check_branch_status";
  huwiyyatMurshid: string;
  branch: string;
}

/** Send a notification to the operator */
export interface MunNotifyCall {
  tool: "mun_notify";
  /** Your orchestrator ID (e.g., TEAM-100, SANDBOX-pos-simulator) */
  huwiyyatMurshid: string;
  message: string;
  priority: "min" | "low" | "default" | "high" | "urgent";
  actions?: Array<{ label: string; action: string }>;
}

/** Send a conversational response to the operator (for answering questions) */
export interface MunReplyCall {
  tool: "mun_reply";
  /** Your orchestrator ID (e.g., TEAM-100, SANDBOX-pos-simulator) */
  huwiyyatMurshid: string;
  message: string;
}

/** Log a decision to the diary */
export interface MunLogDecisionCall {
  tool: "mun_log_decision";
  huwiyyatMurshid: string;
  type: "tadbir" | "tanfidh" | "tanfidh" | "hall" | "risala";
  decision: string;
  reasoning: string;
  metadata?: Record<string, unknown>;
}

/** Query the collective diary for past decisions and context */
export interface MunReadDiaryCall {
  tool: "mun_read_diary";
  huwiyyatMurshid: string;
  /** Filter by orchestrator ID (omit for collective pool) */
  filterOrchestrator?: string;
  /** Filter by decision type */
  type?: "tadbir" | "tanfidh" | "tanfidh" | "hall" | "risala";
  /** Free-text search in decision + reasoning */
  search?: string;
  /** Max results (default 20) */
  limit?: number;
  /** Only decisions since this ISO date */
  since?: string;
}

/** Yield control voluntarily (when blocked or waiting) */
export interface MunYieldCall {
  tool: "mun_yield";
  huwiyyatMurshid: string;
  reason: "masdud" | "muntazir";
  details: string;
  suggestNext?: string; // Optional suggestion for which epic to switch to
}

/** Demand control back (when unblocked and have actionable work) */
export interface MunDemandControlCall {
  tool: "mun_demand_control";
  huwiyyatMurshid: string;
  reason: string;
  priority: "normal" | "urgent";
}

/** Create branch for orchestrator (called once when starting work) */
export interface MunCreateBranchCall {
  tool: "mun_create_branch";
  huwiyyatMurshid: string;
  identifier: string;        // e.g., "TEAM-200"
  type: NawMurshid;    // "epic" or "chore"
  slug?: string;             // e.g., "bab-al-shams" (required for epic, optional for chore)
}

/** Run SSP to slice files into a PR branch (targets main) */
export interface MunSspCall {
  tool: "mun_ssp";
  huwiyyatMurshid: string;
  huwiyyatWasfa: string;
  files: string[];
}

/**
 * Run SSSP (Stacked Single Slice Push) to create a PR branch targeting a parent slice.
 * Used for early push under timeline pressure, or when reviewers need context.
 * 
 * Unlike SSP (which targets main), SSSP creates a stack:
 * - PR #1: BE → main
 * - PR #2: FE → BE (not main)
 * - PR #3: INT → FE
 * 
 * When base PR merges, dependent PRs need rebase cascade.
 */
export interface MunSsspCall {
  tool: "mun_sssp";
  huwiyyatMurshid: string;
  huwiyyatWasfa: string;
  /** Parent ticket ID whose PR branch this should target */
  parentTicketId: string;
  files: string[];
}

/** Commit staged changes */
export interface MunCommitCall {
  tool: "mun_commit";
  huwiyyatMurshid: string;
  message: string;
  files?: string[]; // If provided, only commit these files
}

/** Git add files */
export interface MunGitAddCall {
  tool: "mun_git_add";
  huwiyyatMurshid: string;
  files: string[]; // Files to stage
}

/** Git push current branch */
export interface MunGitPushCall {
  tool: "mun_git_push";
  huwiyyatMurshid: string;
}

// =============================================================================
// Artifact Crafting Tools
// =============================================================================

/** Extract files from forge for artifact creation */
export interface MunIstikhasCall {
  tool: "mun_istikhas";
  huwiyyatMurshid: string;
  huwiyyatWasfa: string;
  files: string[];
}

/** Test extraction for missing dependencies and coupling */
export interface MunTalaumCall {
  tool: "mun_talaum";
  huwiyyatMurshid: string;
  huwiyyatWasfa: string;
  files: string[];
}

/** Craft artifact from extracted files */
export interface MunIstihalCall {
  tool: "mun_istihal";
  huwiyyatMurshid: string;
  huwiyyatWasfa: string;
  files: string[];
}

/** Craft stacked artifact (builds on parent) */
export interface MunIstihalMutabaqqCall {
  tool: "mun_istihal_mutabaqq";
  huwiyyatMurshid: string;
  huwiyyatWasfa: string;
  parentTicketId: string;
  files: string[];
}

/** Unveil artifact by creating PR */
export interface MunFaslCall {
  tool: "mun_fasl";
  huwiyyatMurshid: string;
  huwiyyatWasfa: string;
  title: string;
  body: string;
  draft?: boolean;
}

export type MunToolCall =
  | NidaKhalqWasfa
  | NidaTajdidWasfa
  | MunSetRelationsCall
  | NidaQiraatWasfa
  | MunSliceForPrCall
  | NidaKhalqRisala
  | MunCheckBranchStatusCall
  | MunNotifyCall
  | MunReplyCall
  | MunLogDecisionCall
  | MunReadDiaryCall
  | MunYieldCall
  | MunDemandControlCall
  | MunCreateBranchCall
  | MunSspCall
  | MunSsspCall
  | MunCommitCall
  | MunGitAddCall
  | MunGitPushCall
  | MunIstikhasCall
  | MunTalaumCall
  | MunIstihalCall
  | MunIstihalMutabaqqCall
  | MunFaslCall;

// =============================================================================
// MUN-MCP Tool Registry
// =============================================================================

/** MCP tool definition (JSON Schema for tool input) */
export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

/** Handler function for a registered MCP tool */
export type McpToolHandler = (args: Record<string, unknown>) => Promise<string> | string;

/**
 * Tool registry — all tools are core, built into the MUN-MCP server.
 *
 * MUN-MCP server delegates tool listing and dispatch to this registry.
 */
export interface ToolRegistry {
  /** Register a tool definition + its handler */
  register(tool: McpToolDefinition, handler: McpToolHandler): void;

  /** Get all registered tool definitions (for tools/list) */
  getTools(): McpToolDefinition[];

  /** Get a specific handler by name (for tools/call) */
  getHandler(name: string): McpToolHandler | undefined;

  /** Check if a tool name is registered */
  has(name: string): boolean;

  /** Get the IPC forwarder (for sending events to daemon) */
  getForwarder(): (call: MunToolCall) => void;
}

// =============================================================================
// Orchestrator Diary
// =============================================================================

export interface QararSijill {
  timestamp: string;
  type: "tadbir" | "tanfidh" | "tanfidh" | "hall" | "risala";
  decision: string;
  reasoning: string;
  metadata?: Record<string, unknown>;
}

export interface MakhtutatSijill {
  name: string;
  purpose: string;
  createdAt: string;
  content?: string;
}

export interface HalatTanfidhSijill {
  status: "pending" | "in_progress" | "complete" | "masdud";
  sessionId?: string;
  pr?: number;
  blockedReason?: string;
}

export interface SijillMurshid {
  epicId: string;
  startedAt: string;
  decisions: QararSijill[];
  scriptsCreated: MakhtutatSijill[];
  implementationStatus: Record<string, HalatTanfidhSijill>;
}

// =============================================================================
// Messaging Abstraction
// =============================================================================

/** Where a message should be routed */
export type QanatRisala =
  | "dispatch"                    // Control plane (Telegram dispatch topic, Slack #munadi, etc.)
  | "operator"                      // Direct to operator (private chat)
  | { murshid: string };     // Orchestrator's channel (Telegram topic, Slack thread, etc.)

/** Outbound messaging interface — what daemon modules depend on */
export interface RasulKharij {
  /** Is the messenger operational? */
  mumakkan(): boolean;

  /** Send a plain text message to a channel */
  send(channel: QanatRisala, text: string): Promise<void>;

  /** Send with markdown formatting (falls back to plain if unsupported) */
  arsalaMunassaq(channel: QanatRisala, text: string): Promise<void>;

  /** Create a dedicated channel for an orchestrator (e.g., Telegram topic, Slack channel) */
  khalaqaQanatMurshid(identifier: string, title: string): Promise<string | null>;

  /** Check if an orchestrator has a dedicated channel */
  yamlikQanatMurshid(identifier: string): boolean;

  /** Load all channels for a session from persistence into cache. Returns the channels record. */
  hammalQanawatLilJalsa(identifier: string): Record<string, string>;

  /** Reverse lookup: find orchestrator identifier by provider + channelId. */
  hallJalsaBilQanat(provider: string, channelId: string): string | null;
}

// =============================================================================
// Session Management
// =============================================================================

/** Orchestrator status for control handover */
export type HalatMurshid = "sakin" | "fail" | "masdud" | "muntazir";

/** PR status for keepalive tracking */
export type RisalaMutabaStatus = "draft" | "open" | "merged" | "closed";

/** A PR being tracked by keepalive for PR tracking */
export interface RisalaMutaba {
  huwiyyatWasfa: string;
  raqamRisala: number;
  branch: string;
  status: RisalaMutabaStatus;
  /** When PR was created */
  createdAt: string;
  /** When status last changed */
  statusChangedAt: string;
  /** When comments were last polled (persisted to prevent re-fetching on restart) */
  lastPolledAt?: string;
}

/** Orchestrator type */
export type NawMurshid = "epic" | "chore" | "sandbox";

/**
 * Orchestrator session
 * 
 * - Epic: Multi-ticket work with sub-tickets and blocking relations
 *   Branch: epic/{identifier}-{slug}
 * 
 * - Chore: Single standalone task, no sub-tickets
 *   Branch: {MUNADI_GIT_USER}/{identifier}
 */
export interface JalsatMurshid {
  id: string;
  /** Linear ticket identifier (e.g., TEAM-200, TEAM-300) */
  identifier: string;
  title: string;
  /** Epic = multi-ticket work, Chore = standalone task */
  type: NawMurshid;
  /** Primary branch for this orchestrator */
  branch: string;
  /** Control status: idle/active/blocked/waiting */
  status: HalatMurshid;
  /** Reason if blocked or waiting */
  blockedReason?: string;
  createdAt: string;
  lastMessageAt: string;
  /**
   * PRs created via SSP for PR tracking.
   * Keepalive monitors these for:
   * - Merge detection (paves way for next PR cycle)
   * - Comment interpretation (conditional action per command protocol)
   */
  activePRs: RisalaMutaba[];
  /**
   * Messaging channel IDs keyed by provider.
   * e.g., { telegram: "12345", slack: "C07ABC" }
   * Persisted in the `channels` table, hydrated on session load.
   */
  channels: Record<string, string>;
}



