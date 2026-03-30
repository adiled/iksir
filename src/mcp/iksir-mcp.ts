/**
 * Iksir MCP Server
 *
 * Provides tools to the Murshid LLM:
 *   mun_*    Alchemical operations (transmutation, decanting, inscription)
 *   code_*  Code intelligence (symbol lookup, dependency graph, impact analysis)
 *
 * All alchemical tools are built-in.
 *
 * Communicates with Iksir daemon via SQLite IPC (events table).
 */

import type {
  NidaKhalqWasfa,
  NidaTajdidWasfa,
  MunSetRelationsCall,
  NidaQiraatWasfa,
  NidaKhalqRisala,
  MunCheckBranchStatusCall,
  MunNotifyCall,
  MunReplyCall,
  MunLogDecisionCall,
  MunReadDiaryCall,
  MunYieldCall,
  MunDemandControlCall,
  MunCreateBranchCall,
  MunCommitCall,
  MunGitAddCall,
  MunGitPushCall,
  MunToolCall,
  QararSijill,
  NawMurshid,
  TaarifAlatMcp,
  MuaallijAlatMcp,
  SijillAlat,
} from "../types.ts";
import { generateBranchName } from "../daemon/katib.ts";
import { loadIndex } from "../code-intel/indexer.ts";
import { queryIndex } from "../code-intel/query.ts";

/** MCP Protocol types */
interface McpRequest {
  jsonrpc: "2.0";
  id: number | string;
  method: string;
  params?: Record<string, unknown>;
}

interface McpResponse {
  jsonrpc: "2.0";
  id: number | string;
  result?: unknown;
  error?: { code: number; message: string };
}

import {
  adkhalaHadath,
  adhafaQararSijill,
  jalabaQararatSijill,
  qiraStatus,
} from "../../db/db.ts";


class IksirSijillAlat implements SijillAlat {
  #tools = new Map<string, { definition: TaarifAlatMcp; handler: MuaallijAlatMcp }>();
  #forwarder: (call: MunToolCall) => void;

  constructor(forwarder: (call: MunToolCall) => void) {
    this.#forwarder = forwarder;
  }

  register(tool: TaarifAlatMcp, handler: MuaallijAlatMcp): void {
    this.#tools.set(tool.name, { definition: tool, handler });
  }

  getTools(): TaarifAlatMcp[] {
    return Array.from(this.#tools.values()).map((t) => t.definition);
  }

  getHandler(name: string): MuaallijAlatMcp | undefined {
    return this.#tools.get(name)?.handler;
  }

  has(name: string): boolean {
    return this.#tools.has(name);
  }

  getForwarder(): (call: MunToolCall) => void {
    return this.#forwarder;
  }
}


export class IksirMunMcpServer {
  #registry: IksirSijillAlat;

  constructor() {
    this.#registry = new IksirSijillAlat((call) => this.#forwardToDaemon(call));

    this.#registerCoreTools();
    this.#registerAlchemicalTools();
  }

  /**
   * Expose the registry for external access (e.g., serve.ts health check).
   */
  get registry(): SijillAlat {
    return this.#registry;
  }


  /**
   * Handle incoming MCP request
   */
  async handleRequest(request: McpRequest): Promise<McpResponse> {
    switch (request.method) {
      case "tahyia":
        return this.#handleInitialize(request);
      case "tools/list":
        return this.#handleToolsList(request);
      case "tools/call":
        return this.#handleToolsCall(request);
      default:
        return {
          jsonrpc: "2.0",
          id: request.id,
          error: { code: -32601, message: `Method not found: ${request.method}` },
        };
    }
  }

  /**
   * Handle tahyia request
   */
  #handleInitialize(request: McpRequest): McpResponse {
    return {
      jsonrpc: "2.0",
      id: request.id,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: {
          tools: {},
        },
        serverInfo: {
          name: "munadi-pm-mcp",
          version: "0.1.0",
        },
      },
    };
  }

  /**
   * Handle tools/list request
   */
  #handleToolsList(request: McpRequest): McpResponse {
    return {
      jsonrpc: "2.0",
      id: request.id,
      result: {
        tools: this.#registry.getTools(),
      },
    };
  }

  /**
   * Validate required arguments are present and non-null.
   * Throws with a clear message if validation fails.
   */
  #tahaqqaqArgs(
    toolName: string,
    args: Record<string, unknown>,
  ): void {
    const tools = this.#registry.getTools();
    const tool = tools.find((t) => t.name === toolName);
    if (!tool) return;

    const required = tool.inputSchema.required ?? [];
    const missing = required.filter(
      (field) => args[field] === undefined || args[field] === null,
    );
    if (missing.length > 0) {
      throw new Error(
        `Missing required argument(s) for ${toolName}: ${missing.join(", ")}`,
      );
    }
  }

  /**
   * Handle tools/call request
   */
  async #handleToolsCall(request: McpRequest): Promise<McpResponse> {
    const params = request.params as {
      name: string;
      arguments: Record<string, unknown>;
    };
    const toolName = params?.name;
    const args = params?.arguments ?? {};

    try {
      this.#tahaqqaqArgs(toolName, args);

      const handler = this.#registry.getHandler(toolName);
      if (!handler) {
        return {
          jsonrpc: "2.0",
          id: request.id,
          error: { code: -32602, message: `Unknown tool: ${toolName}` },
        };
      }

      const result = await handler(args);

      return {
        jsonrpc: "2.0",
        id: request.id,
        result: {
          content: [{ type: "text", text: result }],
        },
      };
    } catch (error) {
      return {
        jsonrpc: "2.0",
        id: request.id,
        error: { code: -32000, message: String(error) },
      };
    }
  }


  /**
   * Register all 16 core PM-MCP tools.
   */
  #registerCoreTools(): void {

    this.#registry.register(
      {
        name: "mun_create_wasfa",
        description:
          "Create a new wasfa (وصفة) - a formula for transformation. Each wasfa describes work to be transmuted.",
        inputSchema: {
          type: "object",
          properties: {
            huwiyyatMurshid: {
              type: "string",
              description: "Your murshid ID (e.g., TEAM-100, SANDBOX-pos-simulator)",
            },
            title: {
              type: "string",
              description: "Ticket title (concise, action-oriented)",
            },
            description: {
              type: "string",
              description: "Detailed description including acceptance criteria",
            },
            estimate: {
              type: "number",
              description: "Story point estimate (1, 2, 3, 5, 8)",
            },
            status: {
              type: "string",
              enum: ["triage", "backlog"],
              description:
                "Initial status: triage if ambiguous, backlog if well-scoped",
            },
            labels: {
              type: "array",
              items: { type: "string" },
              description: "Labels to apply (e.g., 'backend', 'frontend')",
            },
            parentId: {
              type: "string",
              description: "Parent ticket ID (use sparingly, prefer relations)",
            },
          },
          required: ["huwiyyatMurshid", "title"],
        },
      },
      (args) => this.#aalajaKhalqWasfa(args),
    );

    this.#registry.register(
      {
        name: "mun_update_wasfa",
        description:
          "Update an existing ticket. Use for grooming, refining estimates, or changing status.",
        inputSchema: {
          type: "object",
          properties: {
            huwiyyatMurshid: {
              type: "string",
              description: "Your murshid ID (e.g., TEAM-100, SANDBOX-pos-simulator)",
            },
            huwiyyatWasfa: {
              type: "string",
              description: "Ticket identifier (e.g., TEAM-200)",
            },
            updates: {
              type: "object",
              properties: {
                title: { type: "string" },
                description: { type: "string" },
                estimate: { type: "number" },
                status: { type: "string" },
              },
              description: "Fields to update",
            },
          },
          required: ["huwiyyatMurshid", "huwiyyatWasfa", "updates"],
        },
      },
      (args) => this.#aalajaTajdidWasfa(args),
    );

    this.#registry.register(
      {
        name: "mun_set_relations",
        description:
          "Set blocking relations between tickets. Primary mechanism for guiding execution order.",
        inputSchema: {
          type: "object",
          properties: {
            huwiyyatMurshid: {
              type: "string",
              description: "Your murshid ID (e.g., TEAM-100, SANDBOX-pos-simulator)",
            },
            huwiyyatWasfa: {
              type: "string",
              description: "Ticket identifier",
            },
            blocks: {
              type: "array",
              items: { type: "string" },
              description: "Tickets that this ticket blocks",
            },
            blockedBy: {
              type: "array",
              items: { type: "string" },
              description: "Tickets that block this ticket",
            },
          },
          required: ["huwiyyatMurshid", "huwiyyatWasfa"],
        },
      },
      (args) => this.#handleSetRelations(args),
    );

    this.#registry.register(
      {
        name: "mun_read_wasfa",
        description: `Read any issue tracker URL (Linear, Jira, GitHub) and get enriched information with Iksir context.

Returns:
- Entity type (ticket, project, comment, milestone, etc.)
- Full details (title, description, status, estimate, labels)
- Relations (blocks, blocked_by, parent, children)
- Attachments and links (Figma, Notion URLs with guidance on what to look for)
- Iksir context (connected sani sessions, implementation status, PR info)
- Comments and activity

Use this as your primary way to understand ticket entities.`,
        inputSchema: {
          type: "object",
          properties: {
            huwiyyatMurshid: {
              type: "string",
              description: "Your murshid ID (e.g., TEAM-100, SANDBOX-pos-simulator)",
            },
            url: {
              type: "string",
              description: "Any issue tracker URL (ticket, project, etc.)",
            },
          },
          required: ["huwiyyatMurshid", "url"],
        },
      },
      (args) => this.#aalajaQiraaatWasfa(args),
    );


    this.#registry.register(
      {
        name: "mun_create_risala",
        description:
          "Create a draft pull request. Daemon handles gh CLI interaction.",
        inputSchema: {
          type: "object",
          properties: {
            huwiyyatMurshid: {
              type: "string",
              description: "Your murshid ID (e.g., TEAM-100, SANDBOX-pos-simulator)",
            },
            huwiyyatWasfa: {
              type: "string",
              description: "Ticket the PR implements",
            },
            title: {
              type: "string",
              description: "PR title - format: 'Description (TICKET-ID)'",
            },
            body: {
              type: "string",
              description: "PR description (markdown)",
            },
            base: {
              type: "string",
              description: "Base branch (usually crucible or main)",
            },
            head: {
              type: "string",
              description: "Head branch with changes",
            },
          },
          required: ["huwiyyatMurshid", "huwiyyatWasfa", "title", "body", "base", "head"],
        },
      },
      (args) => this.#aalajaKhalqRisala(args),
    );

    this.#registry.register(
      {
        name: "mun_check_branch_status",
        description:
          "Check branch status (ahead/behind relative to main, files changed).",
        inputSchema: {
          type: "object",
          properties: {
            huwiyyatMurshid: {
              type: "string",
              description: "Your murshid ID (e.g., TEAM-100, SANDBOX-pos-simulator)",
            },
            branch: {
              type: "string",
              description: "Branch name to check",
            },
          },
          required: ["huwiyyatMurshid", "branch"],
        },
      },
      (args) => this.#handleCheckBranchStatus(args),
    );


    this.#registry.register(
      {
        name: "mun_notify",
        description:
          "Send a notification to al-Kimyawi. Use for blockers, decisions needed, and milestones.",
        inputSchema: {
          type: "object",
          properties: {
            huwiyyatMurshid: {
              type: "string",
              description: "Your murshid ID (e.g., TEAM-100, SANDBOX-pos-simulator). Required for routing.",
            },
            message: {
              type: "string",
              description: "Message content",
            },
            awwaliyya: {
              type: "string",
              enum: ["min", "low", "default", "high", "urgent"],
              description: "Ishara awwaliyya",
            },
            actions: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  label: { type: "string" },
                  action: { type: "string" },
                },
                required: ["label", "action"],
              },
              description: "Action buttons for the notification",
            },
          },
          required: ["huwiyyatMurshid", "message", "awwaliyya"],
        },
      },
      (args) => this.#handleNotify(args),
    );

    this.#registry.register(
      {
        name: "mun_reply",
        description:
          "Send a conversational response to al-Kimyawi. Use this when al-Kimyawi asks a question (not a command). Questions seek information; commands direct action.",
        inputSchema: {
          type: "object",
          properties: {
            huwiyyatMurshid: {
              type: "string",
              description: "Your murshid ID (e.g., TEAM-100, SANDBOX-pos-simulator). Required for routing.",
            },
            message: {
              type: "string",
              description: "The response text (supports markdown lists)",
            },
          },
          required: ["huwiyyatMurshid", "message"],
        },
      },
      (args) => this.#handleReply(args),
    );

    this.#registry.register(
      {
        name: "mun_log_decision",
        description:
          "Log a decision to the diary. Creates persistent record of planning, execution, and learning.",
        inputSchema: {
          type: "object",
          properties: {
            huwiyyatMurshid: {
              type: "string",
              description: "Your murshid ID (e.g., TEAM-100, SANDBOX-pos-simulator)",
            },
            type: {
              type: "string",
              enum: [
                "planning",
                "grooming",
                "execution",
                "blocker_resolution",
                "pr_decision",
              ],
              description: "Type of decision",
            },
            decision: {
              type: "string",
              description: "What was decided",
            },
            reasoning: {
              type: "string",
              description: "Why this decision was made",
            },
            metadata: {
              type: "object",
              description: "Additional structured data (tickets created, etc.)",
            },
          },
          required: ["huwiyyatMurshid", "type", "decision", "reasoning"],
        },
      },
      (args) => this.#handleLogDecision(args),
    );

    this.#registry.register(
      {
        name: "mun_read_diary",
        description: `Query the collective diary for past decisions, learnings, and context.

The diary is a shared knowledge pool across all murshidun. Use it to:
- Check if a similar decision was made before
- Understand precedent for architecture, grooming, or PR strategies
- Learn from past blocker resolutions
- Get context when taking over from another murshid`,
        inputSchema: {
          type: "object",
          properties: {
            huwiyyatMurshid: {
              type: "string",
              description: "Your murshid ID",
            },
            filterOrchestrator: {
              type: "string",
              description: "Filter by a specific murshid ID (omit for collective pool)",
            },
            type: {
              type: "string",
              enum: ["planning", "grooming", "execution", "blocker_resolution", "pr_decision"],
              description: "Filter by decision type",
            },
            search: {
              type: "string",
              description: "Free-text search in decision text and reasoning",
            },
            limit: {
              type: "number",
              description: "Max results to return (default 20)",
            },
            since: {
              type: "string",
              description: "Only return decisions since this ISO date (e.g., 2026-03-01T00:00:00Z)",
            },
          },
          required: ["huwiyyatMurshid"],
        },
      },
      (args) => this.#handleReadDiary(args),
    );


    this.#registry.register(
      {
        name: "mun_yield",
        description: `Yield control voluntarily when blocked or waiting.

Use this when:
- All your formulae are blocked waiting for qarar al-Kimyawis → reason: "masdud"
- All treatises created and waiting for review/merge → reason: "muntazir"

This allows other murshidun with actionable work to become active.
You will continue receiving issue tracker/GitHub updates even while idle.`,
        inputSchema: {
          type: "object",
          properties: {
            huwiyyatMurshid: {
              type: "string",
              description: "Your murshid ID (e.g., TEAM-100, SANDBOX-pos-simulator). Required for routing.",
            },
            reason: {
              type: "string",
              enum: ["masdud", "muntazir"],
              description: "Why yielding: masdud (waiting for decisions) or muntazir (PRs pending)",
            },
            details: {
              type: "string",
              description: "Specific reason (e.g., 'Waiting for qarar al-Kimyawi on Figma specs')",
            },
            suggestNext: {
              type: "string",
              description: "Optional: suggest which epic should become active next",
            },
          },
          required: ["huwiyyatMurshid", "reason", "details"],
        },
      },
      (args) => this.#handleYield(args),
    );

    this.#registry.register(
      {
        name: "mun_demand_control",
        description: `Demand control back when you have actionable work.

Use this when:
- A blocker was resolved and you can proceed
- A PR was merged and you have follow-up work
- An external change means you can continue

This signals to the daemon that you want to become active.
If no other murshid is active, you'll be granted control immediately.
If another murshid is working, Al-Kimyawi will be asked to approve the switch.`,
        inputSchema: {
          type: "object",
          properties: {
            huwiyyatMurshid: {
              type: "string",
              description: "Your murshid ID (e.g., TEAM-100, SANDBOX-pos-simulator). Required for routing.",
            },
            reason: {
              type: "string",
              description: "Why demanding control (e.g., 'Blocker resolved - Figma specs received')",
            },
            awwaliyya: {
              type: "string",
              enum: ["normal", "urgent"],
              description: "Awwaliyya: normal (can wait for current to yield) or urgent (request immediate switch)",
            },
          },
          required: ["huwiyyatMurshid", "reason", "awwaliyya"],
        },
      },
      (args) => this.#handleDemandControl(args),
    );


    this.#registry.register(
      {
        name: "mun_create_branch",
        description: `Create the branch for a new murshid. Called once when starting work.

The daemon will:
1. Ensure main is checked out and clean
2. Pull latest main
3. Create and checkout the branch
4. Push to origin with -u

Branch naming:
- epic: epic/{identifier}-{slug}
- chore: {user}/{identifier}
- sandbox: sandbox/{slug}

You should only call this once per murshid, at the start.`,
        inputSchema: {
          type: "object",
          properties: {
            huwiyyatMurshid: {
              type: "string",
              description: "Your murshid ID (e.g., TEAM-100, SANDBOX-pos-simulator)",
            },
            identifier: {
              type: "string",
              description: "Ticket/epic identifier (e.g., 'TEAM-200') or sandbox identifier (e.g., 'SANDBOX-pos-simulator')",
            },
            type: {
              type: "string",
              enum: ["epic", "chore", "sandbox"],
              description: "Type of murshid: 'epic' for multi-ticket work, 'chore' for standalone tasks, 'sandbox' for freeform work",
            },
            slug: {
              type: "string",
              description: "Short description slug (e.g., 'bab-al-shams'). Required for epics, optional for chores/sandbox.",
            },
          },
          required: ["huwiyyatMurshid", "identifier", "type"],
        },
      },
      (args) => this.#handleCreateBranch(args),
    );

    this.#registry.register(
      {
        name: "mun_git_add",
        description: "Stage files for commit. Use before mun_commit.",
        inputSchema: {
          type: "object",
          properties: {
            huwiyyatMurshid: {
              type: "string",
              description: "Your murshid ID (e.g., TEAM-100, SANDBOX-pos-simulator)",
            },
            files: {
              type: "array",
              items: { type: "string" },
              description: "Files to stage (paths relative to repo root)",
            },
          },
          required: ["huwiyyatMurshid", "files"],
        },
      },
      (args) => this.#handleGitAdd(args),
    );

    this.#registry.register(
      {
        name: "mun_commit",
        description: "Commit staged changes with a message.",
        inputSchema: {
          type: "object",
          properties: {
            huwiyyatMurshid: {
              type: "string",
              description: "Your murshid ID (e.g., TEAM-100, SANDBOX-pos-simulator)",
            },
            message: {
              type: "string",
              description: "Commit message (follow conventional format)",
            },
            files: {
              type: "array",
              items: { type: "string" },
              description: "Optional: specific files to commit (will git add these first)",
            },
          },
          required: ["huwiyyatMurshid", "message"],
        },
      },
      (args) => this.#handleCommit(args),
    );

    this.#registry.register(
      {
        name: "mun_git_push",
        description: "Push current branch to origin.",
        inputSchema: {
          type: "object",
          properties: {
            huwiyyatMurshid: {
              type: "string",
              description: "Your murshid ID (e.g., TEAM-100, SANDBOX-pos-simulator)",
            },
          },
          required: ["huwiyyatMurshid"],
        },
      },
      (args) => this.#handleGitPush(args),
    );


    this.#registry.register(
      {
        name: "code_query",
        description:
          "Query the codebase index for symbol locations, dependencies, impact analysis, and search. " +
          "Use this BEFORE grepping or globbing — it's faster and gives structured results. " +
          "Examples: 'where is MudirJalasat', 'what depends on types.ts', 'impact of changing TasmimIksir', " +
          "'exports of classifier.ts', 'files related to auth'.",
        inputSchema: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "Natural language query about the codebase",
            },
          },
          required: ["query"],
        },
      },
      (args) => this.#handleCodeQuery(args),
    );
  }


  #registerAlchemicalTools(): void {
    this.#registry.register(
      {
        name: "mun_istikhas",
        description: 
          "Extract rune stones from the crucible for transmutation. " +
          "Identifies which stones contain the runes needed for this essence. " +
          "Use mun_talaum to discover if these runes require additional summoning circles.",
        inputSchema: {
          type: "object",
          properties: {
            huwiyyatMurshid: {
              type: "string",
              description: "Your murshid ID (e.g., TEAM-100, SANDBOX-pos-simulator)",
            },
            huwiyyatWasfa: {
              type: "string",
              description: "Ticket the essence is for",
            },
            files: {
              type: "array",
              items: { type: "string" },
              description: "Rune stones to extract (paths relative to crucible root)",
            },
          },
          required: ["huwiyyatMurshid", "huwiyyatWasfa", "files"],
        },
      },
      (args) => this.#handleExtract(args),
    );

    this.#registry.register(
      {
        name: "mun_talaum",
        description:
          "Attune the extracted rune stones — discover summoning circles, contract dependencies, " +
          "missing incantations required for stability. Returns which additional stones must be included. " +
          "Call after mun_istikhas to ensure the runes will function in isolation.",
        inputSchema: {
          type: "object",
          properties: {
            huwiyyatMurshid: {
              type: "string",
              description: "Your murshid ID (e.g., TEAM-100, SANDBOX-pos-simulator)",
            },
            huwiyyatWasfa: {
              type: "string",
              description: "Ticket being attuned",
            },
            files: {
              type: "array",
              items: { type: "string" },
              description: "Rune stones currently selected for extraction",
            },
          },
          required: ["huwiyyatMurshid", "huwiyyatWasfa", "files"],
        },
      },
      (args) => this.#handleAttune(args),
    );

    this.#registry.register(
      {
        name: "mun_istihal",
        description:
          "Transmute rune stones into pure essence. " +
          "The scattered runes crystallize into a coherent whole. " +
          "After transmutation, use mun_fasl to transfer the essence for examination.",
        inputSchema: {
          type: "object",
          properties: {
            huwiyyatMurshid: {
              type: "string",
              description: "Your murshid ID (e.g., TEAM-100, SANDBOX-pos-simulator)",
            },
            huwiyyatWasfa: {
              type: "string",
              description: "Ticket ID for the essence (e.g., 'TEAM-200-BE')",
            },
            files: {
              type: "array",
              items: { type: "string" },
              description: "Rune stones to transmute into essence",
            },
          },
          required: ["huwiyyatMurshid", "huwiyyatWasfa", "files"],
        },
      },
      (args) => this.#handleTransmute(args),
    );

    this.#registry.register(
      {
        name: "mun_istihal_mutabaqq",
        description:
          "Transmute essence that requires another essence as foundation. " +
          "The child essence depends on the parent's properties to remain stable. " +
          "Use when transmutations must be examined in sequence.",
        inputSchema: {
          type: "object",
          properties: {
            huwiyyatMurshid: {
              type: "string",
              description: "Your murshid ID (e.g., TEAM-100, SANDBOX-pos-simulator)",
            },
            huwiyyatWasfa: {
              type: "string",
              description: "Ticket ID for this artifact (e.g., 'TEAM-200-FE')",
            },
            parentTicketId: {
              type: "string",
              description: "Parent ticket ID whose artifact this builds on (e.g., 'TEAM-200-BE')",
            },
            files: {
              type: "array",
              items: { type: "string" },
              description: "Files to include in the essence (paths relative to repo root)",
            },
          },
          required: ["huwiyyatMurshid", "huwiyyatWasfa", "parentTicketId", "files"],
        },
      },
      (args) => this.#handleTransmuteStacked(args),
    );

    this.#registry.register(
      {
        name: "mun_fasl",
        description:
          "Decant the clear essence, separating it from sediment and transferring it for examination. " +
          "Use after mun_istihal to present the essence to reviewers. " +
          "The essence moves from your vessel to theirs.",
        inputSchema: {
          type: "object",
          properties: {
            huwiyyatMurshid: {
              type: "string",
              description: "Your murshid ID (e.g., TEAM-100, SANDBOX-pos-simulator)",
            },
            huwiyyatWasfa: {
              type: "string",
              description: "Ticket the PR implements",
            },
            title: {
              type: "string",
              description: "PR title",
            },
            body: {
              type: "string",
              description: "PR description (markdown)",
            },
            draft: {
              type: "boolean",
              description: "Create as draft PR (default: true)",
            },
          },
          required: ["huwiyyatMurshid", "huwiyyatWasfa", "title", "body"],
        },
      },
      (args) => this.#handleDecant(args),
    );
  }


  async #aalajaKhalqWasfa(args: Record<string, unknown>): Promise<string> {
    const call: NidaKhalqWasfa = {
      tool: "mun_create_wasfa",
      huwiyyatMurshid: args.huwiyyatMurshid as string,
      title: args.title as string,
      description: args.description as string | undefined,
      estimate: args.estimate as number | undefined,
      status: args.status as "triage" | "backlog" | undefined,
      labels: args.labels as string[] | undefined,
      parentId: args.parentId as string | undefined,
    };

    this.#forwardToDaemon(call);

    return `Ticket creation request forwarded to daemon.

Title: ${call.title}
Status: ${call.status ?? "backlog"}
Estimate: ${call.estimate ?? "unestimated"}

Daemon will create the ticket and return the ticket ID.`;
  }

  async #aalajaTajdidWasfa(args: Record<string, unknown>): Promise<string> {
    const call: NidaTajdidWasfa = {
      tool: "mun_update_wasfa",
      huwiyyatMurshid: args.huwiyyatMurshid as string,
      huwiyyatWasfa: args.huwiyyatWasfa as string,
      updates: args.updates as NidaTajdidWasfa["updates"],
    };

    this.#forwardToDaemon(call);

    const updatesList = Object.entries(call.updates)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => `  ${k}: ${v}`)
      .join("\n");

    return `Ticket update request forwarded to daemon.

Ticket: ${call.huwiyyatWasfa}
Updates:
${updatesList}`;
  }

  async #handleSetRelations(args: Record<string, unknown>): Promise<string> {
    const call: MunSetRelationsCall = {
      tool: "mun_set_relations",
      huwiyyatMurshid: args.huwiyyatMurshid as string,
      huwiyyatWasfa: args.huwiyyatWasfa as string,
      blocks: args.blocks as string[] | undefined,
      blockedBy: args.blockedBy as string[] | undefined,
    };

    this.#forwardToDaemon(call);

    const blocksList = call.blocks?.length ? `Blocks: ${call.blocks.join(", ")}` : "";
    const blockedByList = call.blockedBy?.length
      ? `Blocked by: ${call.blockedBy.join(", ")}`
      : "";

    return `Relation update request forwarded to daemon.

Ticket: ${call.huwiyyatWasfa}
${blocksList}
${blockedByList}

Relations control execution order: blocked tickets wait for blockers to complete.`;
  }

  async #aalajaQiraaatWasfa(args: Record<string, unknown>): Promise<string> {
    const call: NidaQiraatWasfa = {
      tool: "mun_read_wasfa",
      huwiyyatMurshid: args.huwiyyatMurshid as string,
      url: args.url as string,
    };

    this.#forwardToDaemon(call);

    /** Extract ticket ID from URL if possible (heuristic) */
    const ticketMatch = call.url.match(/([A-Z]+-\d+)/);
    const huwiyyatWasfa = ticketMatch?.[1];

    /** Check implementation status from SQLite */
    let localContext = "";
    if (huwiyyatWasfa) {
      const status = qiraStatus(huwiyyatWasfa);
      if (status) {
        localContext = `

Local Munadi Context (from diary):
- Implementation Status: ${status.status}
${status.huwiyat_murshid ? `- Murshid: ${status.huwiyat_murshid}` : ""}
${status.summary ? `- Summary: ${status.summary}` : ""}`;
      }
    }

    return `Ticket read request forwarded to daemon.

URL: ${call.url}

Daemon will:
1. Parse URL to determine entity type (ticket, project, comment, etc.)
2. Fetch full details from issue tracker API
3. Extract attachments/links (Figma, Notion) with guidance
4. Enrich with Iksir context (sessions, implementation status, PRs)
5. Return structured response${localContext}

Awaiting daemon response...`;
  }


  async #aalajaKhalqRisala(args: Record<string, unknown>): Promise<string> {
    const call: NidaKhalqRisala = {
      tool: "mun_create_risala",
      huwiyyatMurshid: args.huwiyyatMurshid as string,
      huwiyyatWasfa: args.huwiyyatWasfa as string,
      title: args.title as string,
      body: args.body as string,
      base: args.base as string,
      head: args.head as string,
    };

    this.#forwardToDaemon(call);

    return `PR creation request forwarded to daemon.

Ticket: ${call.huwiyyatWasfa}
Title: ${call.title}
Base: ${call.base}
Head: ${call.head}

Daemon will:
1. Push branch if needed
2. Create draft PR via gh CLI
3. Return PR number and URL
4. Update diary with PR info`;
  }

  async #handleCheckBranchStatus(args: Record<string, unknown>): Promise<string> {
    const call: MunCheckBranchStatusCall = {
      tool: "mun_check_branch_status",
      huwiyyatMurshid: args.huwiyyatMurshid as string,
      branch: args.branch as string,
    };

    this.#forwardToDaemon(call);

    return `Branch status request forwarded to daemon.

Branch: ${call.branch}

Daemon will return:
- Commits ahead/behind main
- Files changed
- Any merge conflicts`;
  }


  async #handleNotify(args: Record<string, unknown>): Promise<string> {
    const call: MunNotifyCall = {
      tool: "mun_notify",
      huwiyyatMurshid: args.huwiyyatMurshid as string,
      message: args.message as string,
      awwaliyya: args.awwaliyya as MunNotifyCall["awwaliyya"],
      actions: args.actions as MunNotifyCall["actions"],
    };

    this.#forwardToDaemon(call);

    const actionsText = call.actions?.length
      ? `\nActions: ${call.actions.map((a) => a.label).join(", ")}`
      : "";

    return `Ishara sent to al-Kimyawi.

Awwaliyya: ${call.awwaliyya}
Message: ${call.message}${actionsText}

Al-Kimyawi will receive this via Telegram/ntfy.`;
  }

  async #handleReply(args: Record<string, unknown>): Promise<string> {
    const call: MunReplyCall = {
      tool: "mun_reply",
      huwiyyatMurshid: args.huwiyyatMurshid as string,
      message: args.message as string,
    };

    this.#forwardToDaemon(call);

    return `Response sent to al-Kimyawi.

${call.message}`;
  }

  async #handleLogDecision(args: Record<string, unknown>): Promise<string> {
    const call: MunLogDecisionCall = {
      tool: "mun_log_decision",
      huwiyyatMurshid: args.huwiyyatMurshid as string,
      type: args.type as MunLogDecisionCall["type"],
      decision: args.decision as string,
      reasoning: args.reasoning as string,
      metadata: args.metadata as Record<string, unknown> | undefined,
    };

    /** Log to diary directly */
    const decision: QararSijill = {
      timestamp: new Date().toISOString(),
      type: call.type,
      decision: call.decision,
      reasoning: call.reasoning,
      metadata: call.metadata,
    };

    this.#appendQararSijill(decision, call.huwiyyatMurshid);

    this.#forwardToDaemon(call);

    return `Decision logged to diary.

Type: ${call.type}
Decision: ${call.decision}
Reasoning: ${call.reasoning}

This decision is now part of the persistent record.`;
  }

  #handleReadDiary(args: Record<string, unknown>): string {
    const call: MunReadDiaryCall = {
      tool: "mun_read_diary",
      huwiyyatMurshid: args.huwiyyatMurshid as string,
      filterOrchestrator: args.filterOrchestrator as string | undefined,
      type: args.type as MunReadDiaryCall["type"],
      search: args.search as string | undefined,
      limit: args.limit as number | undefined,
      since: args.since as string | undefined,
    };

    const decisions = jalabaQararatSijill({
      huwiyyatMurshid: call.filterOrchestrator,
      type: call.type,
      search: call.search,
      limit: call.limit,
      since: call.since,
    });

    if (decisions.length === 0) {
      const filters = [
        call.filterOrchestrator && `murshid=${call.filterOrchestrator}`,
        call.type && `type=${call.type}`,
        call.search && `search="${call.search}"`,
        call.since && `since=${call.since}`,
      ].filter(Boolean);

      return `No diary entries found.${filters.length > 0 ? ` Filters: ${filters.join(", ")}` : ""}`;
    }

    let response = `**Diary** (${decisions.length} entries)\n\n`;

    for (const d of decisions) {
      const meta = d.metadata ? JSON.parse(d.metadata) : null;
      response += `---\n`;
      response += `**[${d.type}]** by ${d.huwiyat_murshid} (${d.created_at})\n`;
      response += `**Decision:** ${d.decision}\n`;
      response += `**Reasoning:** ${d.reasoning}\n`;
      if (meta) {
        response += `**Metadata:** ${JSON.stringify(meta)}\n`;
      }
      response += `\n`;
    }

    return response;
  }


  async #handleYield(args: Record<string, unknown>): Promise<string> {
    const call: MunYieldCall = {
      tool: "mun_yield",
      huwiyyatMurshid: args.huwiyyatMurshid as string,
      reason: args.reason as "masdud" | "muntazir",
      details: args.details as string,
      suggestNext: args.suggestNext as string | undefined,
    };

    this.#forwardToDaemon(call);

    const stateDescription = call.reason === "masdud"
      ? "You are now in BLOCKED state. Al-Kimyawi will be notified of the blockers."
      : "You are now in WAITING state. Monitoring for PR events.";

    return `Control yielded.

Reason: ${call.reason}
Details: ${call.details}
${call.suggestNext ? `Suggested next: ${call.suggestNext}` : ""}

${stateDescription}

What happens next:
- If queue has pending work → another murshid becomes active
- If other murshidun have work → Al-Kimyawi can approve switch
- If nobody has work → system idles until external event

You will continue receiving issue tracker/GitHub updates.
Use \`mun_demand_control\` when you have actionable work again.`;
  }

  async #handleDemandControl(args: Record<string, unknown>): Promise<string> {
    const call: MunDemandControlCall = {
      tool: "mun_demand_control",
      huwiyyatMurshid: args.huwiyyatMurshid as string,
      reason: args.reason as string,
      awwaliyya: args.awwaliyya as "normal" | "urgent",
    };

    this.#forwardToDaemon(call);

    return `Control demand submitted.

Reason: ${call.reason}
Awwaliyya: ${call.awwaliyya}

Daemon will:
1. If no active murshid → grant control immediately
2. If active is blocked/waiting → grant control (graceful snatch)
3. If active is working:
   - Normal: queue demand, notify al-Kimyawi
   - Urgent: request immediate switch from al-Kimyawi

You will be notified when control is granted.`;
  }


  async #handleCreateBranch(args: Record<string, unknown>): Promise<string> {
    const murshidType = args.type as NawMurshid;
    const call: MunCreateBranchCall = {
      tool: "mun_create_branch",
      huwiyyatMurshid: args.huwiyyatMurshid as string,
      identifier: args.identifier as string,
      type: murshidType,
      slug: args.slug as string | undefined,
    };

    this.#forwardToDaemon(call);

    const branchName = generateBranchName(call.identifier, murshidType, call.slug);

    return `Branch creation request submitted.

Branch: ${branchName}
Type: ${murshidType}

Daemon will:
1. Ensure current branch is clean
2. Checkout and pull main
3. Create branch: ${branchName}
4. Push to origin with -u

You will be notified when the branch is ready.`;
  }

  async #handleGitAdd(args: Record<string, unknown>): Promise<string> {
    const call: MunGitAddCall = {
      tool: "mun_git_add",
      huwiyyatMurshid: args.huwiyyatMurshid as string,
      files: args.files as string[],
    };

    this.#forwardToDaemon(call);

    return `Git add request submitted.

Files (${call.files.length}):
${call.files.map((f) => `  - ${f}`).join("\n")}

Daemon will stage these files.`;
  }

  async #handleCommit(args: Record<string, unknown>): Promise<string> {
    const call: MunCommitCall = {
      tool: "mun_commit",
      huwiyyatMurshid: args.huwiyyatMurshid as string,
      message: args.message as string,
      files: args.files as string[] | undefined,
    };

    this.#forwardToDaemon(call);

    return `Commit request submitted.

Message: ${call.message}
${call.files ? `Files: ${call.files.join(", ")}` : "Files: all staged"}

Daemon will create the commit.`;
  }

  async #handleGitPush(args: Record<string, unknown>): Promise<string> {
    const call: MunGitPushCall = {
      tool: "mun_git_push",
      huwiyyatMurshid: args.huwiyyatMurshid as string,
    };

    this.#forwardToDaemon(call);

    return `Push request submitted.

Daemon will push current branch to origin.`;
  }


  async #handleExtract(args: Record<string, unknown>): Promise<string> {
    /**
     * For now, extraction is just validation and planning
     * The actual file operations happen in mun_istihal
     */
    const huwiyyatWasfa = args.huwiyyatWasfa as string;
    const files = args.files as string[];

    return `Rune stones identified for ${huwiyyatWasfa}.

Stones selected (${files.length}):
${files.map((f) => `  - ${f}`).join("\n")}

Next steps:
1. Use mun_talaum to verify these runes are complete
2. Use mun_istihal to crystallize into essence`;
  }

  async #handleAttune(args: Record<string, unknown>): Promise<string> {
    /**
     * TODO: Implement smart dependency discovery
     * For now, return a placeholder that suggests manual review
     */
    const huwiyyatWasfa = args.huwiyyatWasfa as string;
    const files = args.files as string[];

    return `Attunement analysis for ${huwiyyatWasfa}:

Rune stones selected (${files.length}):
${files.map((f) => `  - ${f}`).join("\n")}

Runic Analysis:
- Summoning circles: Check if all summoned stones are included
- Contract dependencies: Verify all contracts are complete
- Purity runes: Ensure test stones accompany incantation stones

This is a placeholder. Future implementation will:
- Trace summoning runes to their source stones
- Detect incomplete contract chains
- Identify coupled incantations
- Determine if layered transmutation is needed`;
  }

  async #handleTransmute(args: Record<string, unknown>): Promise<string> {
    const call = {
      tool: "mun_istihal" as const,
      huwiyyatMurshid: args.huwiyyatMurshid as string,
      huwiyyatWasfa: args.huwiyyatWasfa as string,
      files: args.files as string[],
    };

    this.#forwardToDaemon(call);

    const essenceBranch = generateBranchName(call.huwiyyatWasfa, "chore");

    return `Artifact crafting request submitted.

Ticket: ${call.huwiyyatWasfa}
Essence Branch: ${essenceBranch}
Files (${call.files.length}):
${call.files.map((f) => `  - ${f}`).join("\n")}

Daemon will:
1. Merge origin/main into forge branch
2. Create ${essenceBranch} from main
3. Extract files from forge branch
4. Commit and push

If conflicts occur, you will be notified with resolution guidance.
On success, use mun_fasl to create the PR.`;
  }

  async #handleTransmuteStacked(args: Record<string, unknown>): Promise<string> {
    const call = {
      tool: "mun_istihal_mutabaqq" as const,
      huwiyyatMurshid: args.huwiyyatMurshid as string,
      huwiyyatWasfa: args.huwiyyatWasfa as string,
      parentTicketId: args.parentTicketId as string,
      files: args.files as string[],
    };

    this.#forwardToDaemon(call);

    const essenceBranch = generateBranchName(call.huwiyyatWasfa, "chore");
    const parentBranch = generateBranchName(call.parentTicketId, "chore");

    return `Stacked artifact crafting request submitted.

Ticket: ${call.huwiyyatWasfa}
Essence Branch: ${essenceBranch}
Parent Branch: ${parentBranch}
Files (${call.files.length}):
${call.files.map((f) => `  - ${f}`).join("\n")}

Daemon will:
1. Fetch latest ${parentBranch} from origin
2. Create ${essenceBranch} from ${parentBranch}
3. Extract files from forge branch
4. Commit and push

On success, use mun_fasl with base pointing to parent branch.
Note: CI may fail if parent PR is unmerged. This is expected for incremental review.`;
  }

  async #handleDecant(args: Record<string, unknown>): Promise<string> {
    /** This is essentially mun_create_risala with better terminology */
    const huwiyyatWasfa = args.huwiyyatWasfa as string;
    const essenceBranch = generateBranchName(huwiyyatWasfa, "chore");

    const call: NidaKhalqRisala = {
      tool: "mun_create_risala",
      huwiyyatMurshid: args.huwiyyatMurshid as string,
      huwiyyatWasfa: huwiyyatWasfa,
      title: args.title as string,
      body: args.body as string,
      base: "main",
      head: essenceBranch,
    };

    this.#forwardToDaemon(call);

    return `Unveiling request submitted.

Ticket: ${huwiyyatWasfa}
Title: ${call.title}
Branch: ${essenceBranch}

Daemon will create a ${args.draft !== false ? "draft " : ""}pull request.
You will be notified with the PR URL once created.`;
  }


  /**
   * Forward a tool call to the Iksir daemon via SQLite
   */
  #forwardToDaemon(call: MunToolCall): void {
    /** Extract huwiyyatMurshid if present (for routing) */
    const huwiyyatMurshid = "huwiyyatMurshid" in call ? (call as { huwiyyatMurshid?: string }).huwiyyatMurshid : undefined;

    adkhalaHadath("pm", call.tool, call as unknown as Record<string, unknown>, huwiyyatMurshid);
  }

  /**
   * Append a decision to the diary (SQLite)
   */
  #appendQararSijill(decision: QararSijill, huwiyyatMurshid: string = "unknown"): void {
    adhafaQararSijill({
      huwiyyatMurshid,
      type: decision.type,
      decision: decision.decision,
      reasoning: decision.reasoning,
      metadata: decision.metadata,
    });
  }


  async #handleCodeQuery(args: Record<string, unknown>): Promise<string> {
    const query = args.query as string;
    if (!query) return JSON.stringify({ error: "query is required" });

    const index = await loadIndex();
    if (!index) {
      return JSON.stringify({
        error: "Code index not built yet. It will be available after the next maintenance cycle.",
        hint: "The keepalive process builds the index during its housekeeping window.",
      });
    }

    const result = queryIndex(index, query);
    return JSON.stringify(result, null, 2);
  }
}
