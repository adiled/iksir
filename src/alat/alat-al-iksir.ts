/**
 * Alat al-Iksir (آلات الإكسير) — The Instruments of Iksir
 *
 * The workshop's apparatus — the instruments themselves, and the
 * hands that work them:
 *
 *   mun_*   the alchemical operations — istihal, fasl, naqsh
 *   code_*  the reading of runuz — symbols, dependencies, impact
 *
 * Their taarif ride in Iksir's hello. humd merges every forager's
 * into the foragerTools it hands each worker, so a nida returns
 * here by name alone.
 *
 * Each instrument inscribes its hadath into the ahdath table, and
 * Munaffidh drains it. The sijill is the record; the thrum is the road.
 */

import type {
  MuaallijAla,
  MunToolCall,
  NawMurshid,
  NidaFahasFar,
  NidaIdfa,
  NidaIltazim,
  NidaIqraMudawwana,
  NidaKhalqFar,
  NidaFasl,
  NidaKhalqWasfa,
  NidaSafa,
  NidaQiraatWasfa,
  NidaRadd,
  NidaRattib,
  NidaSajjalQarar,
  NidaTabligh,
  NidaTajdidWasfa,
  NidaTalabTahakkum,
  NidaTanazal,
  NidaWadaaAlaqat,
  QararSijill,
  SijillAlat,
  TaarifAla,
} from "../types.ts";
import { wallidIsmFar } from "../khuddam/katib.ts";
import { loadIndex } from "../code-intel/indexer.ts";
import { queryIndex } from "../code-intel/query.ts";

import { adhafaQararSijill, adkhalaHadath, jalabaQararatSijill, qiraStatus } from "../../db/db.ts";

class MunadiSijillAlat implements SijillAlat {
  #khazana = new Map<string, { tarif: TaarifAla; muaalij: MuaallijAla }>();
  #muhawwil: (call: MunToolCall) => void;

  constructor(forwarder: (call: MunToolCall) => void) {
    this.#muhawwil = forwarder;
  }

  sajjil(tool: TaarifAla, muaalij: MuaallijAla): void {
    this.#khazana.set(tool.name, { tarif: tool, muaalij });
  }

  adawat(): TaarifAla[] {
    return Array.from(this.#khazana.values()).map((t) => t.tarif);
  }

  muaallijLi(name: string): MuaallijAla | undefined {
    return this.#khazana.get(name)?.muaalij;
  }

  yujad(name: string): boolean {
    return this.#khazana.has(name);
  }

  muwassil(): (call: MunToolCall) => void {
    return this.#muhawwil;
  }
}

export class AlatAlIksir {
  #sijillAlat: SijillAlat;

  constructor() {
    this.#sijillAlat = new MunadiSijillAlat((call) => this.#hawwilLiKhadim(call));

    this.#sajjilAlatAsasiyya();
    this.#sajjilAlatKimiya();
  }

  /** The sijill of instruments. */
  get sijill(): SijillAlat {
    return this.#sijillAlat;
  }

  /** Every taarif, as the hello advertises them. */
  adawat(): TaarifAla[] {
    return this.#sijillAlat.adawat();
  }

  /**
   * Work one instrument.
   *
   * Returns the natija as text — what travels back on chi:"tool-result"
   * to un-park the cell. A refused or broken instrument returns its
   * complaint in the same channel; the murshid must be told either way,
   * and a cell left parked is worse than a cell told no.
   */
  async naffidh(name: string, args: Record<string, unknown>): Promise<string> {
    try {
      this.#tahaqqaqHujaj(name, args);

      const muaalij = this.#sijillAlat.muaallijLi(name);
      if (!muaalij) return `Error: unknown instrument: ${name}`;

      return await muaalij(args);
    } catch (error) {
      return `Error: ${String(error)}`;
    }
  }

  /**
   * Validate required arguments are present and non-null.
   * Throws with a clear message if validation fails.
   */
  #tahaqqaqHujaj(
    toolName: string,
    args: Record<string, unknown>,
  ): void {
    const tools = this.#sijillAlat.adawat();
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
   * Register the core instruments.
   */
  #sajjilAlatAsasiyya(): void {
    this.#sijillAlat.sajjil(
      {
        name: "mun_khalaq_wasfa",
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
              description: "Initial status: triage if ambiguous, backlog if well-scoped",
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

    this.#sijillAlat.sajjil(
      {
        name: "mun_jaddid_wasfa",
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

    this.#sijillAlat.sajjil(
      {
        name: "mun_wadaa_alaqat",
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
      (args) => this.#aalijWadaaAlaqat(args),
    );

    this.#sijillAlat.sajjil(
      {
        name: "mun_iqra_wasfa",
        description:
          `Read a wasfa from the register by name.

Returns what it says, its condition, its measure, its marks, what it
stands under, what it holds back and what holds it, and whether work on
it has begun.`,
        inputSchema: {
          type: "object",
          properties: {
            huwiyyatMurshid: {
              type: "string",
              description: "Your murshid name",
            },
            huwiyya: {
              type: "string",
              description: "The name of the wasfa to read",
            },
          },
          required: ["huwiyyatMurshid", "huwiyya"],
        },
      },
      (args) => this.#aalajaQiraaatWasfa(args),
    );


    this.#sijillAlat.sajjil(
      {
        name: "mun_fahas_far",
        description: "Check branch status (ahead/behind relative to main, files changed).",
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
      (args) => this.#aalijFahasFar(args),
    );

    this.#sijillAlat.sajjil(
      {
        name: "mun_balligh",
        description:
          "Send a notification to al-Kimyawi. Use for blockers, decisions needed, and milestones.",
        inputSchema: {
          type: "object",
          properties: {
            huwiyyatMurshid: {
              type: "string",
              description:
                "Your murshid ID (e.g., TEAM-100, SANDBOX-pos-simulator). Required for routing.",
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
      (args) => this.#aalijTabligh(args),
    );

    this.#sijillAlat.sajjil(
      {
        name: "mun_radd",
        description:
          "Send a conversational response to al-Kimyawi. Use this when al-Kimyawi asks a question (not a command). Questions seek information; commands direct action.",
        inputSchema: {
          type: "object",
          properties: {
            huwiyyatMurshid: {
              type: "string",
              description:
                "Your murshid ID (e.g., TEAM-100, SANDBOX-pos-simulator). Required for routing.",
            },
            message: {
              type: "string",
              description: "The response text (supports markdown lists)",
            },
          },
          required: ["huwiyyatMurshid", "message"],
        },
      },
      (args) => this.#aalijRadd(args),
    );

    this.#sijillAlat.sajjil(
      {
        name: "mun_sajjal_qarar",
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
      (args) => this.#aalijTasjilQarar(args),
    );

    this.#sijillAlat.sajjil(
      {
        name: "mun_iqra_mudawwana",
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
            filterMurshid: {
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
      (args) => this.#aalijQiraatMudawwana(args),
    );

    this.#sijillAlat.sajjil(
      {
        name: "mun_tanazal",
        description: `Yield control voluntarily when blocked or waiting.

Use this when:
- All your formulae are blocked waiting for qarar al-Kimyawis → reason: "masdud"
- All treatises created and waiting for review/merge → reason: "muntazir"

This allows other murshidun with actionable work to become active.
Whispers will still reach you while you rest.`,
        inputSchema: {
          type: "object",
          properties: {
            huwiyyatMurshid: {
              type: "string",
              description:
                "Your murshid ID (e.g., TEAM-100, SANDBOX-pos-simulator). Required for routing.",
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
      (args) => this.#aalijTanazal(args),
    );

    this.#sijillAlat.sajjil(
      {
        name: "mun_talab_tahakkum",
        description: `Demand control back when you have actionable work.

Use this when:
- A blocker was resolved and you can proceed
- A PR was merged and you have follow-up work
- An external change means you can continue

This tells al-Khadim you would take the flame.
If no other murshid is active, you'll be granted control immediately.
If another murshid is working, Al-Kimyawi will be asked to approve the switch.`,
        inputSchema: {
          type: "object",
          properties: {
            huwiyyatMurshid: {
              type: "string",
              description:
                "Your murshid ID (e.g., TEAM-100, SANDBOX-pos-simulator). Required for routing.",
            },
            reason: {
              type: "string",
              description:
                "Why demanding control (e.g., 'Blocker resolved - Figma specs received')",
            },
            awwaliyya: {
              type: "string",
              enum: ["normal", "urgent"],
              description:
                "Awwaliyya: normal (can wait for current to yield) or urgent (request immediate switch)",
            },
          },
          required: ["huwiyyatMurshid", "reason", "awwaliyya"],
        },
      },
      (args) => this.#aalijTalabTahakkum(args),
    );

    this.#sijillAlat.sajjil(
      {
        name: "mun_khalaq_far",
        description: `Create the branch for a new murshid. Called once when starting work.

al-Khadim will:
1. Ensure main is checked out and clean
2. Pull latest main
3. Create and intaqalaIla the branch
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
              description:
                "Ticket/epic identifier (e.g., 'TEAM-200') or sandbox identifier (e.g., 'SANDBOX-pos-simulator')",
            },
            type: {
              type: "string",
              enum: ["epic", "chore", "sandbox"],
              description:
                "Type of murshid: 'epic' for multi-ticket work, 'chore' for standalone tasks, 'sandbox' for freeform work",
            },
            slug: {
              type: "string",
              description:
                "Short description slug (e.g., 'bab-al-shams'). Required for epics, optional for chores/sandbox.",
            },
          },
          required: ["huwiyyatMurshid", "identifier", "type"],
        },
      },
      (args) => this.#aalijKhalqFar(args),
    );

    this.#sijillAlat.sajjil(
      {
        name: "mun_rattib",
        description: "Stage files for commit. Use before mun_iltazim.",
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
      (args) => this.#aalijRattib(args),
    );

    this.#sijillAlat.sajjil(
      {
        name: "mun_iltazim",
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
              description: "Which matter to fix. All that is molten, when unstated.",
            },
          },
          required: ["huwiyyatMurshid", "message"],
        },
      },
      (args) => this.#aalijIltazim(args),
    );

    this.#sijillAlat.sajjil(
      {
        name: "mun_idfa",
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
      (args) => this.#aalijIdfa(args),
    );

    this.#sijillAlat.sajjil(
      {
        name: "mun_istifsar",
        description:
          "Query the codebase index for symbol locations, dependencies, impact analysis, and search. " +
          "Use this BEFORE grepping or globbing — it's faster and gives structured results. " +
          "Examples: 'where is MudirJalasat', 'what depends on types.ts', 'impact of changing TasmimIksir', " +
          "'exports of mumayyiz.ts', 'files related to auth'.",
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
      (args) => this.#aalijIstifsar(args),
    );
  }

  #sajjilAlatKimiya(): void {
    this.#sijillAlat.sajjil(
      {
        name: "mun_istikhlas",
        description: "Extract rune stones from the crucible for transmutation. " +
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
      (args) => this.#aalijIstikhlas(args),
    );

    this.#sijillAlat.sajjil(
      {
        name: "mun_talaum",
        description:
          "Attune the extracted rune stones — discover summoning circles, contract dependencies, " +
          "missing incantations required for stability. Returns which additional stones must be included. " +
          "Call after mun_istikhlas to ensure the runes will function in isolation.",
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
      (args) => this.#aalijTalaum(args),
    );

    this.#sijillAlat.sajjil(
      {
        name: "mun_istihal",
        description: "Transmute rune stones into pure essence. " +
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
      (args) => this.#aalijIstihal(args),
    );

    this.#sijillAlat.sajjil(
      {
        name: "mun_istihal_mutabaqq",
        description: "Transmute essence that requires another essence as foundation. " +
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
      (args) => this.#aalijIstihalMutabaqq(args),
    );

    this.#sijillAlat.sajjil(
      {
        name: "mun_safa",
        description:
          `Set the jawhar to the fire the waṣfa declared.

The maʿāyīr al-ṣafāʾ were written into the waṣfa before the work began.
This puts the matter to them. It withstands them or it does not; there is
no opinion in it and nothing to negotiate.

Ṣafāʾ must hold before faṣl. A jawhar is not set before al-Kimyawī to be
judged — it is set before al-Kimyawī having already survived its fire.`,
        inputSchema: {
          type: "object",
          properties: {
            huwiyyatMurshid: { type: "string", description: "Your murshid name" },
            huwiyyatWasfa: { type: "string", description: "The waṣfa whose fire this is" },
          },
          required: ["huwiyyatMurshid", "huwiyyatWasfa"],
        },
      },
      (args) => this.#aalijSafa(args),
    );

    this.#sijillAlat.sajjil(
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
      (args) => this.#aalijFasl(args),
    );
  }

  #aalijSafa(args: Record<string, unknown>): string {
    const call: NidaSafa = {
      tool: "mun_safa",
      huwiyyatMurshid: args.huwiyyatMurshid as string,
      huwiyyatWasfa: args.huwiyyatWasfa as string,
    };
    this.#hawwilLiKhadim(call);
    return `The matter of ${call.huwiyyatWasfa} goes to the fire. You will be told what stood.`;
  }

  async #aalajaKhalqWasfa(args: Record<string, unknown>): Promise<string> {
    const call: NidaKhalqWasfa = {
      tool: "mun_khalaq_wasfa",
      huwiyyatMurshid: args.huwiyyatMurshid as string,
      unwan: args.title as string,
      wasf: args.description as string | undefined,
      taqdir: args.estimate as number | undefined,
      hala: args.status as "triage" | "backlog" | undefined,
      wasamat: args.labels as string[] | undefined,
      huwiyyatAb: args.parentId as string | undefined,
    };

    this.#hawwilLiKhadim(call);

    return `The inscription of a wasfa is carried to al-Khadim.

Title: ${call.unwan}
Status: ${call.hala ?? "backlog"}
Estimate: ${call.taqdir ?? "unestimated"}

Daemon will create the ticket and return the ticket ID.`;
  }

  async #aalajaTajdidWasfa(args: Record<string, unknown>): Promise<string> {
    const call: NidaTajdidWasfa = {
      tool: "mun_jaddid_wasfa",
      huwiyyatMurshid: args.huwiyyatMurshid as string,
      huwiyyatWasfa: args.huwiyyatWasfa as string,
      updates: args.updates as NidaTajdidWasfa["updates"],
    };

    this.#hawwilLiKhadim(call);

    const updatesList = Object.entries(call.updates)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => `  ${k}: ${v}`)
      .join("\n");

    return `The alteration is carried to al-Khadim.

Ticket: ${call.huwiyyatWasfa}
Updates:
${updatesList}`;
  }

  async #aalijWadaaAlaqat(args: Record<string, unknown>): Promise<string> {
    const call: NidaWadaaAlaqat = {
      tool: "mun_wadaa_alaqat",
      huwiyyatMurshid: args.huwiyyatMurshid as string,
      huwiyyatWasfa: args.huwiyyatWasfa as string,
      yahjub: args.blocks as string[] | undefined,
      mahjoubBi: args.blockedBy as string[] | undefined,
    };

    this.#hawwilLiKhadim(call);

    const blocksList = call.yahjub?.length ? `Blocks: ${call.yahjub.join(", ")}` : "";
    const blockedByList = call.mahjoubBi?.length ? `Blocked by: ${call.mahjoubBi.join(", ")}` : "";

    return `The binding is carried to al-Khadim.

Ticket: ${call.huwiyyatWasfa}
${blocksList}
${blockedByList}

Relations control execution order: blocked tickets wait for blockers to complete.`;
  }

  async #aalajaQiraaatWasfa(args: Record<string, unknown>): Promise<string> {
    const call: NidaQiraatWasfa = {
      tool: "mun_iqra_wasfa",
      huwiyyatMurshid: args.huwiyyatMurshid as string,
      huwiyya: args.huwiyya as string,
    };

    this.#hawwilLiKhadim(call);

    let siyaqMahalli = "";
    const hala = qiraStatus(call.huwiyya);
    if (hala) {
      siyaqMahalli = `

From the sijill:
- State: ${hala.status}
${hala.huwiyat_murshid ? `- Murshid: ${hala.huwiyat_murshid}` : ""}
${hala.summary ? `- Summary: ${hala.summary}` : ""}`;
    }

    return `Reading ${call.huwiyya} from the register.${siyaqMahalli}`;
  }

  async #aalijFahasFar(args: Record<string, unknown>): Promise<string> {
    const call: NidaFahasFar = {
      tool: "mun_fahas_far",
      huwiyyatMurshid: args.huwiyyatMurshid as string,
      far: args.branch as string,
    };

    this.#hawwilLiKhadim(call);

    return `The question of the vessel is carried to al-Khadim.

Branch: ${call.far}

Daemon will return:
- Commits ahead/behind main
- Files changed
- Any merge conflicts`;
  }

  async #aalijTabligh(args: Record<string, unknown>): Promise<string> {
    const call: NidaTabligh = {
      tool: "mun_balligh",
      huwiyyatMurshid: args.huwiyyatMurshid as string,
      risala: args.message as string,
      awwaliyya: args.awwaliyya as NidaTabligh["awwaliyya"],
      afaal: args.actions as NidaTabligh["afaal"],
    };

    this.#hawwilLiKhadim(call);

    const actionsText = call.afaal?.length
      ? `\nActions: ${call.afaal.map((a) => a.label).join(", ")}`
      : "";

    return `Ishara sent to al-Kimyawi.

Awwaliyya: ${call.awwaliyya}
Message: ${call.risala}${actionsText}

Al-Kimyawi will receive this via Telegram/ntfy.`;
  }

  async #aalijRadd(args: Record<string, unknown>): Promise<string> {
    const call: NidaRadd = {
      tool: "mun_radd",
      huwiyyatMurshid: args.huwiyyatMurshid as string,
      risala: args.message as string,
    };

    this.#hawwilLiKhadim(call);

    return `Response sent to al-Kimyawi.

${call.risala}`;
  }

  async #aalijTasjilQarar(args: Record<string, unknown>): Promise<string> {
    const call: NidaSajjalQarar = {
      tool: "mun_sajjal_qarar",
      huwiyyatMurshid: args.huwiyyatMurshid as string,
      naw: args.type as NidaSajjalQarar["naw"],
      qarar: args.decision as string,
      mantiq: args.reasoning as string,
      bayyanat: args.metadata as Record<string, unknown> | undefined,
    };

    /** Log to diary directly */
    const decision: QararSijill = {
      waqt: new Date().toISOString(),
      naw: call.naw,
      qarar: call.qarar,
      mantiq: call.mantiq,
      bayyanat: call.bayyanat,
    };

    this.#adhifQararSijill(decision, call.huwiyyatMurshid);

    this.#hawwilLiKhadim(call);

    return `Decision logged to diary.

Type: ${call.naw}
Decision: ${call.qarar}
Reasoning: ${call.mantiq}

This decision is now part of the persistent record.`;
  }

  #aalijQiraatMudawwana(args: Record<string, unknown>): string {
    const call: NidaIqraMudawwana = {
      tool: "mun_iqra_mudawwana",
      huwiyyatMurshid: args.huwiyyatMurshid as string,
      murshidMuhaddad: args.filterMurshid as string | undefined,
      naw: args.type as NidaIqraMudawwana["naw"],
      bahth: args.search as string | undefined,
      hadd: args.limit as number | undefined,
      mundhu: args.since as string | undefined,
    };

    const decisions = jalabaQararatSijill({
      huwiyyatMurshid: call.murshidMuhaddad,
      type: call.naw,
      search: call.bahth,
      limit: call.hadd,
      since: call.mundhu,
    });

    if (decisions.length === 0) {
      const filters = [
        call.murshidMuhaddad && `murshid=${call.murshidMuhaddad}`,
        call.naw && `type=${call.naw}`,
        call.bahth && `search="${call.bahth}"`,
        call.mundhu && `since=${call.mundhu}`,
      ].filter(Boolean);

      return `No diary entries found.${
        filters.length > 0 ? ` Filters: ${filters.join(", ")}` : ""
      }`;
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

  async #aalijTanazal(args: Record<string, unknown>): Promise<string> {
    const call: NidaTanazal = {
      tool: "mun_tanazal",
      huwiyyatMurshid: args.huwiyyatMurshid as string,
      sabab: args.reason as "masdud" | "muntazir",
      tafasil: args.details as string,
      iqtarahTali: args.suggestNext as string | undefined,
    };

    this.#hawwilLiKhadim(call);

    const stateDescription = call.sabab === "masdud"
      ? "You are now in BLOCKED state. Al-Kimyawi will be notified of the blockers."
      : "You are now in WAITING state. Monitoring for PR events.";

    return `Control yielded.

Reason: ${call.sabab}
Details: ${call.tafasil}
${call.iqtarahTali ? `Suggested next: ${call.iqtarahTali}` : ""}

${stateDescription}

What happens next:
- If queue has pending work → another murshid becomes active
- If other murshidun have work → Al-Kimyawi can approve switch
- If nobody has work → system idles until external event

Whispers will still reach you.
Use \`mun_talab_tahakkum\` when you have actionable work again.`;
  }

  async #aalijTalabTahakkum(args: Record<string, unknown>): Promise<string> {
    const call: NidaTalabTahakkum = {
      tool: "mun_talab_tahakkum",
      huwiyyatMurshid: args.huwiyyatMurshid as string,
      sabab: args.reason as string,
      awwaliyya: args.awwaliyya as "normal" | "urgent",
    };

    this.#hawwilLiKhadim(call);

    return `Control demand submitted.

Reason: ${call.sabab}
Awwaliyya: ${call.awwaliyya}

Daemon will:
1. If no active murshid → grant control immediately
2. If active is blocked/waiting → grant control (graceful snatch)
3. If active is working:
   - Normal: queue demand, notify al-Kimyawi
   - Urgent: request immediate switch from al-Kimyawi

You will be notified when control is granted.`;
  }

  async #aalijKhalqFar(args: Record<string, unknown>): Promise<string> {
    const murshidType = args.type as NawMurshid;
    const call: NidaKhalqFar = {
      tool: "mun_khalaq_far",
      huwiyyatMurshid: args.huwiyyatMurshid as string,
      huwiyya: args.identifier as string,
      naw: murshidType,
      kunya: args.slug as string | undefined,
    };

    this.#hawwilLiKhadim(call);

    const branchName = wallidIsmFar(call.huwiyya, murshidType, call.kunya);

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

  async #aalijRattib(args: Record<string, unknown>): Promise<string> {
    const call: NidaRattib = {
      tool: "mun_rattib",
      huwiyyatMurshid: args.huwiyyatMurshid as string,
      ahjar: args.files as string[],
    };

    this.#hawwilLiKhadim(call);

    return `Git add request submitted.

Files (${call.ahjar.length}):
${call.ahjar.map((f) => `  - ${f}`).join("\n")}

Daemon will stage these files.`;
  }

  async #aalijIltazim(args: Record<string, unknown>): Promise<string> {
    const call: NidaIltazim = {
      tool: "mun_iltazim",
      huwiyyatMurshid: args.huwiyyatMurshid as string,
      risala: args.message as string,
      ahjar: args.files as string[] | undefined,
    };

    this.#hawwilLiKhadim(call);

    return `Commit request submitted.

Message: ${call.risala}
${call.ahjar ? `Files: ${call.ahjar.join(", ")}` : "Files: all staged"}

Daemon will create the commit.`;
  }

  async #aalijIdfa(args: Record<string, unknown>): Promise<string> {
    const call: NidaIdfa = {
      tool: "mun_idfa",
      huwiyyatMurshid: args.huwiyyatMurshid as string,
    };

    this.#hawwilLiKhadim(call);

    return `Push request submitted.

Daemon will push current branch to origin.`;
  }

  async #aalijIstikhlas(args: Record<string, unknown>): Promise<string> {
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

  async #aalijTalaum(args: Record<string, unknown>): Promise<string> {
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

  async #aalijIstihal(args: Record<string, unknown>): Promise<string> {
    const call = {
      tool: "mun_istihal" as const,
      huwiyyatMurshid: args.huwiyyatMurshid as string,
      huwiyyatWasfa: args.huwiyyatWasfa as string,
      ahjar: args.files as string[],
    };

    this.#hawwilLiKhadim(call);

    const essenceBranch = wallidIsmFar(call.huwiyyatWasfa, "chore");

    return `Artifact crafting request submitted.

Ticket: ${call.huwiyyatWasfa}
Essence Branch: ${essenceBranch}
Files (${call.ahjar.length}):
${call.ahjar.map((f) => `  - ${f}`).join("\n")}

Daemon will:
1. Merge origin/main into forge branch
2. Create ${essenceBranch} from main
3. Extract files from forge branch
4. Commit and push

If conflicts occur, you will be notified with resolution guidance.
On success, use mun_fasl to create the PR.`;
  }

  async #aalijIstihalMutabaqq(args: Record<string, unknown>): Promise<string> {
    const call = {
      tool: "mun_istihal_mutabaqq" as const,
      huwiyyatMurshid: args.huwiyyatMurshid as string,
      huwiyyatWasfa: args.huwiyyatWasfa as string,
      huwiyyatAbWasfa: args.parentTicketId as string,
      ahjar: args.files as string[],
    };

    this.#hawwilLiKhadim(call);

    const essenceBranch = wallidIsmFar(call.huwiyyatWasfa, "chore");
    const parentBranch = wallidIsmFar(call.huwiyyatAbWasfa, "chore");

    return `Stacked artifact crafting request submitted.

Ticket: ${call.huwiyyatWasfa}
Essence Branch: ${essenceBranch}
Parent Branch: ${parentBranch}
Files (${call.ahjar.length}):
${call.ahjar.map((f) => `  - ${f}`).join("\n")}

Daemon will:
1. Fetch latest ${parentBranch} from origin
2. Create ${essenceBranch} from ${parentBranch}
3. Extract files from forge branch
4. Commit and push

On success, use mun_fasl with base pointing to parent branch.
Note: CI may fail if parent PR is unmerged. This is expected for incremental review.`;
  }

  #hawwilLiKhadim(call: MunToolCall): void {
    const huwiyyatMurshid = "huwiyyatMurshid" in call
      ? (call as { huwiyyatMurshid?: string }).huwiyyatMurshid
      : undefined;

    adkhalaHadath("pm", call.tool, call as unknown as Record<string, unknown>, huwiyyatMurshid);
  }

  /** Append a qarar to the mudawwana. */
  #adhifQararSijill(decision: QararSijill, huwiyyatMurshid: string = "unknown"): void {
    adhafaQararSijill({
      huwiyyatMurshid,
      type: decision.naw,
      decision: decision.qarar,
      reasoning: decision.mantiq,
      metadata: decision.bayyanat,
    });
  }

  #aalijFasl(args: Record<string, unknown>): string {
    const call: NidaFasl = {
      tool: "mun_fasl",
      huwiyyatMurshid: args.huwiyyatMurshid as string,
      huwiyyatWasfa: args.huwiyyatWasfa as string,
      unwan: args.title as string,
      matn: args.body as string,
      musawwada: args.draft !== false,
    };

    this.#hawwilLiKhadim(call);

    return `The jawhar of ${call.huwiyyatWasfa} goes to be set down.\n\n` +
      `It will be refused if the matter has not withstood its fire.`;
  }

  async #aalijIstifsar(args: Record<string, unknown>): Promise<string> {
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
