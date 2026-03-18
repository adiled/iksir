/**
 * Iksir Core Types
 *
 * Type definitions for the Iksir autonomous agent tansiq system.
 */


export interface TasmimIksir {
  polling: TasmimIstiftaa;
  quietHours: TasmimSaatSukun;
  notifications: TasmimIsharat;
  issueTracker: TasmimMutabiWasfa;
  github: TasmimGitHub;
  opencode: TasmimOpenCode;
  prompts: TasmimHaththat;
}

export interface TasmimIstiftaa {
  defaultIntervalMs: number;
  /** Minimum interval between polls of the same PR (ms). Default: 60000 */
  prPollIntervalMs: number;
}

export interface TasmimSaatSukun {
  enabled: boolean;
  start: string;
  end: string;
  timezone: string;
  blockersPassthrough: boolean;
  /** How many minutes before quiet hours end to run maintenance. Default: 60 */
  maintenanceWindowMinutes: number;
}

export interface TasmimIsharat {
  ntfy: TasmimNtfy;
  telegram: TasmimTelegram;
}

export interface TasmimNtfy {
  enabled: boolean;
  topic: string;
  server: string;
}

export interface TasmimTelegram {
  enabled: boolean;
  botToken: string;
  chatId: string;
  /** Forum-enabled supergroup for Iksir operations */
  groupId?: string;
  /** Dispatch topic ID in the group (for spawning murshids) */
  dispatchTopicId?: number;
  /** SOCKS5 proxy URL (e.g., "socks5://localhost:1080") */
  proxy?: string;
}

export interface TasmimMutabiWasfa {
  /** Provider name: "linear" | "jira" | "github" */
  provider?: string;
  apiKey: string;
  teamId: string;
  /** Regex pattern for ticket identifiers. Default: "[A-Z]+-\\d+" */
  ticketPattern?: string;
}


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

export interface MashruMutabi {
  id: string;
  name: string;
  description?: string;
  url?: string;
  issueCount?: number;
}

export interface MaalimMutabi {
  id: string;
  name: string;
  url?: string;
  startsAt?: string;
  endsAt?: string;
}

export interface RabitWasfaMuhallal {
  type: NawKiyan;
  id: string;
}

export interface MudkhalKhalqQadiya {
  title: string;
  description?: string;
  estimate?: number;
  status?: string;
  labels?: string[];
  parentId?: string;
}

export interface MudkhalTahdithQadiya {
  title?: string;
  description?: string;
  estimate?: number;
  status?: string;
}

export interface MurashihatQadiya {
  assigneeId?: string;
  status?: string;
  cycleId?: string;
}

export interface MutabiWasfa {
  readonly provider: string;
  isAuthenticated(): Promise<boolean>;

  getIssue(identifier: string): Promise<WasfaMutaba | null>;
  getProject(id: string): Promise<MashruMutabi | null>;
  searchIssues(query: string, limit?: number): Promise<WasfaMutaba[]>;
  searchProjects(query: string): Promise<MashruMutabi[]>;

  createIssue(input: MudkhalKhalqQadiya): Promise<WasfaMutaba>;
  updateIssue(id: string, input: MudkhalTahdithQadiya): Promise<WasfaMutaba>;
  setRelations(identifier: string, blocks?: string[], blockedBy?: string[]): Promise<void>;

  parseUrl(url: string): RabitWasfaMuhallal | null;
  getUrlPattern(): RegExp;

  getStateId(name: string): Promise<string | null>;

  searchMilestones?(query: string): Promise<MaalimMutabi[]>;
  getActiveMilestone?(): Promise<MaalimMutabi | null>;
  getFilteredIssues?(filters: MurashihatQadiya, limit?: number): Promise<WasfaMutaba[]>;
}

export interface TasmimGitHub {
  owner: string;
  repo: string;
  ismKimyawi: string;
}

export interface TasmimOpenCode {
  server: string;
}

export interface TasmimHaththat {
  /** Path to tanbih tamyiz prompt template */
  mayyazaTanbih?: string;
  /** Path to sual tamyiz prompt template */
  mayyazaSual?: string;
}


export type AwwaliyyatIshara = "min" | "low" | "default" | "high" | "urgent";

export type SinfIshara =
  | "blocker"
  | "decision"
  | "progress"
  | "pr_ready"
  | "review_comments"
  | "milestone"
  | "external_change"
  | "quiet_hours_exit";

export interface Ishara {
  category: SinfIshara;
  title: string;
  body: string;
  awwaliyya: AwwaliyyatIshara;
  actions?: FiilIshara[];
  url?: string;
  projectId?: string;
  huwiyyatWasfa?: string;
}

export interface FiilIshara {
  label: string;
  action: string;
  url?: string;
}


export interface TaaliqMuraja {
  id: string;
  raqamRisala: number;
  author: string;
  body: string;
  path?: string;
  line?: number;
  createdAt: Date;
  isAlKimyawi: boolean;
  assessment: TaqyimTaaliq;
}

export interface TaqyimTaaliq {
  isCommand: boolean;
  intent: "command" | "suggestion" | "question" | "praise" | "concern" | "neutral";
  confidence: number;
  reasoning: string;
}


export type MustawaSijill = "debug" | "info" | "warn" | "error";

export interface MudkhalSijill {
  timestamp: Date;
  level: MustawaSijill;
  category: string;
  message: string;
  context?: Record<string, unknown>;
}

export interface DecisionMudkhalSijill extends MudkhalSijill {
  event: string;
  interpretation: string;
  action: string;
  reasoning: string;
}

export interface MudkhalTaghyirKhariji extends MudkhalSijill {
  source: "linear" | "github" | "figma" | "notion";
  entityType: string;
  entityId: string;
  author: string;
  changes: Record<string, { before: unknown; after: unknown }>;
  impact: string;
}


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


/** A single question option */
export interface KhiyarSual {
  label: string;
  description: string;
}

/** A single question in a question request */
export interface MaalumatSual {
  /** Very short label (max 30 chars) */
  header: string;
  /** The full question text */
  question: string;
  /** Available choices */
  options: KhiyarSual[];
  /** Allow selecting multiple choices */
  multiple?: boolean;
  /** Allow custom text answer (default true) */
  custom?: boolean;
}

/** A question.asked event from OpenCode SSE */
export interface HadathSualMatlub {
  type: "question.asked";
  properties: {
    /** Unique question request ID */
    id: string;
    /** Session that asked the question */
    sessionID: string;
    /** The questions being asked */
    questions: MaalumatSual[];
    /** Tool context if from a tool call */
    tool?: {
      messageID: string;
      callID: string;
    };
  };
}

/** An answer to a question */
export interface JawabSual {
  /** Index of the question in the questions array */
  questionIndex: number;
  /** Selected option labels */
  selected: string[];
  /** Custom text answer if provided */
  custom?: string;
}

/** Tamyiz result for a sual */
export interface TasnifSual {
  tamyiz: "DHAHAB" | "KHABATH";
  reason: string;
  /** Terse guidance if KHABATH */
  rejection: string | null;
  /** Label of option to auto-select if KHABATH */
  autoAnswer: string | null;
}

/** Pending question state */
export interface SualMuallaq {
  id: string;
  sessionID: string;
  huwiyyatMurshid: string;
  questions: MaalumatSual[];
  telegramMessageId?: number;
  createdAt: string;
}


/**
 * Tool calls made by murshids via MUN-MCP.
 * These are dispatched by the daemon's tool executor.
 */

/** Create a new ticket */
export interface NidaKhalqWasfa {
  tool: "mun_khalaq_wasfa";
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
  tool: "mun_jaddid_wasfa";
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
  tool: "mun_wadaa_alaqat";
  huwiyyatMurshid: string;
  huwiyyatWasfa: string;
  blocks?: string[];
  blockedBy?: string[];
}

/** Read any issue tracker URL — returns enriched info with context */
export interface NidaQiraatWasfa {
  tool: "mun_iqra_wasfa";
  huwiyyatMurshid: string;
  url: string;
}

/** Create a draft PR */
export interface NidaKhalqRisala {
  tool: "mun_khalaq_risala";
  huwiyyatMurshid: string;
  huwiyyatWasfa: string;
  title: string;
  body: string;
  base: string;
  head: string;
}

/** Check branch status (ahead/behind) */
export interface MunCheckBranchStatusCall {
  tool: "mun_fahas_far";
  huwiyyatMurshid: string;
  branch: string;
}

/** Send a notification to al-Kimyawi */
export interface MunNotifyCall {
  tool: "mun_balligh";
  /** Your murshid ID (e.g., TEAM-100, SANDBOX-pos-simulator) */
  huwiyyatMurshid: string;
  message: string;
  awwaliyya: "min" | "low" | "default" | "high" | "urgent";
  actions?: Array<{ label: string; action: string }>;
}

/** Send a conversational response to al-Kimyawi (for answering questions) */
export interface MunReplyCall {
  tool: "mun_radd";
  /** Your murshid ID (e.g., TEAM-100, SANDBOX-pos-simulator) */
  huwiyyatMurshid: string;
  message: string;
}

/** Log a decision to the diary */
export interface MunLogDecisionCall {
  tool: "mun_sajjal_qarar";
  huwiyyatMurshid: string;
  type: "tadbir" | "tanfidh" | "tanfidh" | "hall" | "risala";
  decision: string;
  reasoning: string;
  metadata?: Record<string, unknown>;
}

/** Query the collective diary for past decisions and context */
export interface MunReadDiaryCall {
  tool: "mun_iqra_mudawwana";
  huwiyyatMurshid: string;
  /** Filter by murshid ID (omit for collective pool) */
  filterMurshid?: string;
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
  tool: "mun_tanazal";
  huwiyyatMurshid: string;
  reason: "masdud" | "muntazir";
  details: string;
  suggestNext?: string;
}

/** Demand control back (when unblocked and have actionable work) */
export interface MunDemandControlCall {
  tool: "mun_talab_tahakkum";
  huwiyyatMurshid: string;
  reason: string;
  awwaliyya: "normal" | "urgent";
}

/** Create branch for murshid (called once when starting work) */
export interface MunCreateBranchCall {
  tool: "mun_khalaq_far";
  huwiyyatMurshid: string;
  identifier: string;
  type: NawMurshid;
  slug?: string;
}

/** Commit staged changes */
export interface MunCommitCall {
  tool: "mun_iltazim";
  huwiyyatMurshid: string;
  message: string;
  files?: string[];
}

/** Git add files */
export interface MunGitAddCall {
  tool: "mun_rattib";
  huwiyyatMurshid: string;
  files: string[];
}

/** Git push current branch */
export interface MunGitPushCall {
  tool: "mun_idfa";
  huwiyyatMurshid: string;
}


/** Extract files from forge for artifact creation */
export interface MunIstikhasCall {
  tool: "mun_istikhlas";
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
  | NidaKhalqRisala
  | MunCheckBranchStatusCall
  | MunNotifyCall
  | MunReplyCall
  | MunLogDecisionCall
  | MunReadDiaryCall
  | MunYieldCall
  | MunDemandControlCall
  | MunCreateBranchCall
  | MunCommitCall
  | MunGitAddCall
  | MunGitPushCall
  | MunIstikhasCall
  | MunTalaumCall
  | MunIstihalCall
  | MunIstihalMutabaqqCall
  | MunFaslCall;


/** MCP tool definition (JSON Schema for tool input) */
export interface TaarifAlatMcp {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

/** Handler function for a registered MCP tool */
export type MuaallijAlatMcp = (args: Record<string, unknown>) => Promise<string> | string;

/**
 * Tool registry — all tools are core, built into the MUN-MCP server.
 *
 * MUN-MCP server delegates tool listing and dispatch to this registry.
 */
export interface SijillAlat {
  /** Register a tool definition + its handler */
  register(tool: TaarifAlatMcp, handler: MuaallijAlatMcp): void;

  /** Get all registered tool definitions (for tools/list) */
  adawat(): TaarifAlatMcp[];

  /** Get a specific handler by name (for tools/call) */
  muaallijLi(name: string): MuaallijAlatMcp | undefined;

  /** Check if a tool name is registered */
  has(name: string): boolean;

  /** Get the IPC forwarder (for sending events to daemon) */
  muwassil(): (call: MunToolCall) => void;
}


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


/** Where a message should be routed */
export type QanatRisala =
  | "dispatch"
  | "kimyawi"
  | { murshid: string };

/** Outbound messaging interface — what daemon modules depend on */
export interface RasulKharij {
  /** Is the messenger operational? */
  mumakkan(): boolean;

  /** Send a plain text message to a channel */
  send(channel: QanatRisala, text: string): Promise<void>;

  /** Send with markdown formatting (falls back to plain if unsupported) */
  arsalaMunassaq(channel: QanatRisala, text: string): Promise<void>;

  /** Create a dedicated channel for an murshid (e.g., Telegram topic, Slack channel) */
  khalaqaQanatMurshid(identifier: string, title: string): Promise<string | null>;

  /** Check if an murshid has a dedicated channel */
  yamlikQanatMurshid(identifier: string): boolean;

  /** Load all channels for a session from persistence into cache. Returns the channels record. */
  hammalQanawatLilJalsa(identifier: string): Record<string, string>;

  /** Reverse lookup: find murshid identifier by provider + channelId. */
  hallJalsaBilQanat(provider: string, channelId: string): string | null;
}


/** Murshid status for control handover */
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

/** Murshid type */
export type NawMurshid = "epic" | "chore" | "sandbox";

/**
 * Murshid session
 * 
 * - Epic: Multi-ticket work with sub-tickets and blocking relations
 *   Branch: epic/{identifier}-{slug}
 * 
 * - Chore: Single standalone task, no sub-tickets
 *   Branch: {IKSIR_GIT_USER}/{identifier}
 */
export interface JalsatMurshid {
  id: string;
  /** Linear ticket identifier (e.g., TEAM-200, TEAM-300) */
  identifier: string;
  title: string;
  /** Epic = multi-ticket work, Chore = standalone task */
  type: NawMurshid;
  /** Primary branch for this murshid */
  branch: string;
  /** Control status: idle/active/blocked/waiting */
  status: HalatMurshid;
  /** Reason if blocked or waiting */
  blockedReason?: string;
  createdAt: string;
  lastMessageAt: string;
  /**
   * Risālāt created via istihal for tracking.
   * Hayāt monitors these for:
   * - Merge detection (paves way for next risāla cycle)
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



