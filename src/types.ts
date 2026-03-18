/**
 * Iksir Core Types
 *
 * Type definitions for the Iksir autonomous agent tansiq system.
 */


export interface TasmimIksir {
  istiftaa: TasmimIstiftaa;
  saatSukun: TasmimSaatSukun;
  isharat: TasmimIsharat;
  mutabiWasfa: TasmimMutabiWasfa;
  github: TasmimGitHub;
  opencode: TasmimOpenCode;
  hafazat: TasmimHaththat;
}

export interface TasmimIstiftaa {
  fajwatZamaniyya: number;
  /** Minimum interval between polls of the same PR (ms). Default: 60000 */
  fajwatRaqabaRisala: number;
}

export interface TasmimSaatSukun {
  mufattah: boolean;
  bidaya: string;
  nihaya: string;
  mintaqaZamaniyya: string;
  tanaqqulMasdud: boolean;
  /** How many minutes before quiet hours end to run maintenance. Default: 60 */
  daqaiqNafizhaSeyana: number;
}

export interface TasmimIsharat {
  ntfy: TasmimNtfy;
  telegram: TasmimTelegram;
}

export interface TasmimNtfy {
  mufattah: boolean;
  topic: string;
  server: string;
}

export interface TasmimTelegram {
  mufattah: boolean;
  ramzBot: string;
  huwiyyatMuhadatha: string;
  /** Forum-enabled supergroup for Iksir operations */
  huwiyyatMajmuua?: string;
  /** Dispatch topic ID in the group (for spawning murshids) */
  huwiyyatMawduuIrsal?: number;
  /** SOCKS5 proxy URL (e.g., "socks5://localhost:1080") */
  proxy?: string;
}

export interface TasmimMutabiWasfa {
  /** Provider name: "linear" | "jira" | "github" */
  muqaddim?: string;
  miftahApi: string;
  huwiyyatFareeq: string;
  /** Regex pattern for ticket identifiers. Default: "[A-Z]+-\\d+" */
  namatWasfa?: string;
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
  sahib: string;
  makhzan: string;
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
  sinf: SinfIshara;
  unwan: string;
  matn: string;
  awwaliyya: AwwaliyyatIshara;
  afaal?: FiilIshara[];
  url?: string;
  huwiyyatMashru?: string;
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
  unwan: string;
  wasf?: string;
  taqdir?: number;
  hala?: "triage" | "backlog";
  wasamat?: string[];
  huwiyyatAb?: string;
}

/** Update an existing ticket */
export interface NidaTajdidWasfa {
  tool: "mun_jaddid_wasfa";
  huwiyyatMurshid: string;
  huwiyyatWasfa: string;
  updates: {
    unwan?: string;
    wasf?: string;
    taqdir?: number;
    hala?: string;
  };
}

/** Set blocking relations between tickets */
export interface NidaWadaaAlaqat {
  tool: "mun_wadaa_alaqat";
  huwiyyatMurshid: string;
  huwiyyatWasfa: string;
  yahjub?: string[];
  mahjoubBi?: string[];
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
  unwan: string;
  matn: string;
  asas: string;
  ras: string;
}

/** Check branch status (ahead/behind) */
export interface NidaFahasFar {
  tool: "mun_fahas_far";
  huwiyyatMurshid: string;
  far: string;
}

/** Send a notification to al-Kimyawi */
export interface NidaTabligh {
  tool: "mun_balligh";
  /** Your murshid ID (e.g., TEAM-100, SANDBOX-pos-simulator) */
  huwiyyatMurshid: string;
  risala: string;
  awwaliyya: "min" | "low" | "default" | "high" | "urgent";
  afaal?: Array<{ label: string; action: string }>;
}

/** Send a conversational response to al-Kimyawi (for answering questions) */
export interface NidaRadd {
  tool: "mun_radd";
  /** Your murshid ID (e.g., TEAM-100, SANDBOX-pos-simulator) */
  huwiyyatMurshid: string;
  risala: string;
}

/** Log a decision to the diary */
export interface NidaSajjalQarar {
  tool: "mun_sajjal_qarar";
  huwiyyatMurshid: string;
  naw: "tadbir" | "tanfidh" | "tanfidh" | "hall" | "risala";
  qarar: string;
  mantiq: string;
  bayyanat?: Record<string, unknown>;
}

/** Query the collective diary for past decisions and context */
export interface NidaIqraMudawwana {
  tool: "mun_iqra_mudawwana";
  huwiyyatMurshid: string;
  /** Filter by murshid ID (omit for collective pool) */
  murshidMuhaddad?: string;
  /** Filter by decision type */
  naw?: "tadbir" | "tanfidh" | "tanfidh" | "hall" | "risala";
  /** Free-text search in decision + reasoning */
  bahth?: string;
  /** Max results (default 20) */
  hadd?: number;
  /** Only decisions since this ISO date */
  mundhu?: string;
}

/** Yield control voluntarily (when blocked or waiting) */
export interface NidaTanazal {
  tool: "mun_tanazal";
  huwiyyatMurshid: string;
  sabab: "masdud" | "muntazir";
  tafasil: string;
  iqtarahTali?: string;
}

/** Demand control back (when unblocked and have actionable work) */
export interface NidaTalabTahakkum {
  tool: "mun_talab_tahakkum";
  huwiyyatMurshid: string;
  sabab: string;
  awwaliyya: "normal" | "urgent";
}

/** Create branch for murshid (called once when starting work) */
export interface NidaKhalqFar {
  tool: "mun_khalaq_far";
  huwiyyatMurshid: string;
  huwiyya: string;
  naw: NawMurshid;
  kunya?: string;
}

/** Commit staged changes */
export interface NidaIltazim {
  tool: "mun_iltazim";
  huwiyyatMurshid: string;
  risala: string;
  ahjar?: string[];
}

/** Git add files */
export interface NidaRattib {
  tool: "mun_rattib";
  huwiyyatMurshid: string;
  ahjar: string[];
}

/** Git push current branch */
export interface NidaIdfa {
  tool: "mun_idfa";
  huwiyyatMurshid: string;
}


/** Extract files from forge for artifact creation */
export interface NidaIstikhlas {
  tool: "mun_istikhlas";
  huwiyyatMurshid: string;
  huwiyyatWasfa: string;
  ahjar: string[];
}

/** Test extraction for missing dependencies and coupling */
export interface NidaTalaum {
  tool: "mun_talaum";
  huwiyyatMurshid: string;
  huwiyyatWasfa: string;
  ahjar: string[];
}

/** Craft artifact from extracted files */
export interface NidaIstihal {
  tool: "mun_istihal";
  huwiyyatMurshid: string;
  huwiyyatWasfa: string;
  ahjar: string[];
}

/** Craft stacked artifact (builds on parent) */
export interface NidaIstihalMutabaqq {
  tool: "mun_istihal_mutabaqq";
  huwiyyatMurshid: string;
  huwiyyatWasfa: string;
  huwiyyatAbWasfa: string;
  ahjar: string[];
}

/** Unveil artifact by creating PR */
export interface NidaFasl {
  tool: "mun_fasl";
  huwiyyatMurshid: string;
  huwiyyatWasfa: string;
  unwan: string;
  matn: string;
  musawwada?: boolean;
}

/** Naqsh (نقش — inscription): merge the risala into the codex */
export interface NidaNaqsh {
  tool: "mun_naqsh";
  huwiyyatMurshid: string;
  huwiyyatWasfa: string;
  raqamRisala: number;
}

export type MunToolCall =
  | NidaKhalqWasfa
  | NidaTajdidWasfa
  | NidaWadaaAlaqat
  | NidaQiraatWasfa
  | NidaKhalqRisala
  | NidaFahasFar
  | NidaTabligh
  | NidaRadd
  | NidaSajjalQarar
  | NidaIqraMudawwana
  | NidaTanazal
  | NidaTalabTahakkum
  | NidaKhalqFar
  | NidaIltazim
  | NidaRattib
  | NidaIdfa
  | NidaIstikhlas
  | NidaTalaum
  | NidaIstihal
  | NidaIstihalMutabaqq
  | NidaFasl
  | NidaNaqsh;


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
  sajjil(tool: TaarifAlatMcp, handler: MuaallijAlatMcp): void;

  /** Get all registered tool definitions (for tools/list) */
  adawat(): TaarifAlatMcp[];

  /** Get a specific handler by name (for tools/call) */
  muaallijLi(name: string): MuaallijAlatMcp | undefined;

  /** Check if a tool name is registered */
  yujad(name: string): boolean;

  /** Get the IPC forwarder (for sending events to daemon) */
  muwassil(): (call: MunToolCall) => void;
}


export interface QararSijill {
  waqt: string;
  naw: "tadbir" | "tanfidh" | "tanfidh" | "hall" | "risala";
  qarar: string;
  mantiq: string;
  bayyanat?: Record<string, unknown>;
}

export interface MakhtutatSijill {
  ism: string;
  gharad: string;
  unshiaFi: string;
  matn?: string;
}

export interface HalatTanfidhSijill {
  hala: "pending" | "in_progress" | "complete" | "masdud";
  huwiyyatJalsa?: string;
  risala?: number;
  illa?: string;
}

export interface SijillMurshid {
  huwiyyatMalhamat: string;
  badaFi: string;
  qararat: QararSijill[];
  nusakhMunshaa: MakhtutatSijill[];
  halatTanfidh: Record<string, HalatTanfidhSijill>;
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
  far: string;
  hala: RisalaMutabaStatus;
  /** When PR was created */
  unshiaFi: string;
  /** When status last changed */
  ghuyiratHalaFi: string;
  /** When comments were last polled (persisted to prevent re-fetching on restart) */
  akhirRaqabaFi?: string;
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
  huwiyya: string;
  unwan: string;
  /** Epic = multi-ticket work, Chore = standalone task */
  naw: NawMurshid;
  /** Primary branch for this murshid */
  far: string;
  /** Control status: idle/active/blocked/waiting */
  hala: HalatMurshid;
  /** Reason if blocked or waiting */
  illa?: string;
  unshiaFi: string;
  akhirRisalaFi: string;
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



