/**
 * Alat al-Iksir (آلات الإكسير) — The Instruments of Iksir
 *
 * The workshop's apparatus — the instruments themselves, and the
 * hands that work them:
 *
 *   mun_*   the alchemical operations — istihal, safa, fasl
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
  NidaIqraMudawwana,
  NidaFasl,
  NidaKhalqWasfa,
  NidaSafa,
  NidaShahada,
  NidaRadd,
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
import type { SijillWasfat } from "../wasfa/sijill-wasfat.ts";

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

  async naffidh(ism: string, hujaj: Record<string, unknown>): Promise<string> {
    const tarif = this.#khazana.get(ism);
    if (!tarif) throw new Error(`Unknown tool: ${ism}`);
    const missing = (tarif.tarif.inputSchema.required ?? []).filter(
      (field) => hujaj[field] === undefined || hujaj[field] === null,
    );
    if (missing.length > 0) {
      throw new Error(`Missing required argument(s) for ${ism}: ${missing.join(", ")}`);
    }
    return tarif.muaalij(hujaj);
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
  #wasfat?: SijillWasfat;

  constructor(wasfat?: SijillWasfat) {
    this.#wasfat = wasfat;
    this.#sijillAlat = new MunadiSijillAlat((call) => this.#hawwilLiKhadim(call));

    this.#sajjilAlatAsasiyya();
    this.#sajjilAlatKimiya();
  }

  get sijill(): SijillAlat {
    return this.#sijillAlat;
  }

  adawat(): TaarifAla[] {
    return this.#sijillAlat.adawat();
  }

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
            huwiyya: {
              type: "string",
              description: "Its name, when it already has one in the outer tracker (e.g. ENG-123); left out, the Sijill mints one",
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
            mayayir: {
              type: "array",
              items: { type: "string" },
              description:
                "Maʿāyīr al-ṣafāʾ — the fire mun_safa puts the jawhar to: each a command run in the workshop, withstood when it exits 0. Declared before the work begins.",
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
                mayayir: {
                  type: "array",
                  items: { type: "string" },
                  description: "Maʿāyīr al-ṣafāʾ — commands run in the workshop; exit 0 withstands. Replaces the fire whole.",
                },
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

  }

  #sajjilAlatKimiya(): void {
    this.#sijillAlat.sajjil(
      {
        name: "mun_shahada",
        description:
          `Testimony. Only al-Ṣayrafī speaks it: what the fire left, where the jawhar
was set down, or that it entered the codex. No opinion rides in it — exit codes,
places, names. The Sijill believes nothing else.`,
        inputSchema: {
          type: "object",
          properties: {
            huwiyyatWasfa: { type: "string", description: "The waṣfa this testimony is for" },
            naw: { type: "string", enum: ["safa", "fasl", "naqsh"], description: "Which duty was done" },
            natijat: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  mayar: { type: "string", description: "The maʿyār, exactly as declared" },
                  kharaja: { type: "number", description: "Its exit code" },
                  qawl: { type: "string", description: "The tail of what it said" },
                },
                required: ["mayar", "kharaja", "qawl"],
              },
              description: "safa: one entry per maʿyār, in order",
            },
            rabit: { type: "string", description: "fasl/naqsh: where the jawhar stands (a URL)" },
            huwiyya: { type: "string", description: "fasl: the jawhar's name at the forge (e.g. 71)" },
            khata: { type: "string", description: "Why the duty could not be done, when it could not" },
          },
          required: ["huwiyyatWasfa", "naw"],
        },
      },
      (args) => this.#aalijShahada(args),
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
          "Use only after mun_safa has said the matter stood; al-Ṣayrafī sets it down. " +
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
      huwiyya: args.huwiyya as string | undefined,
      unwan: args.title as string,
      wasf: args.description as string | undefined,
      taqdir: args.estimate as number | undefined,
      hala: args.status as "triage" | "backlog" | undefined,
      wasamat: args.labels as string[] | undefined,
      huwiyyatAb: args.parentId as string | undefined,
      mayayir: args.mayayir as string[] | undefined,
    };

    this.#hawwilLiKhadim(call);

    return `The inscription of a wasfa is carried to al-Khadim.

Title: ${call.unwan}
Status: ${call.hala ?? "backlog"}
Estimate: ${call.taqdir ?? "unestimated"}

Daemon will create the ticket and return the ticket ID.`;
  }

  async #aalajaTajdidWasfa(args: Record<string, unknown>): Promise<string> {
    const tahdith = (args.updates ?? {}) as Record<string, unknown>;
    const call: NidaTajdidWasfa = {
      tool: "mun_jaddid_wasfa",
      huwiyyatMurshid: args.huwiyyatMurshid as string,
      huwiyyatWasfa: args.huwiyyatWasfa as string,
      updates: {
        unwan: tahdith.title as string | undefined,
        wasf: tahdith.description as string | undefined,
        taqdir: tahdith.estimate as number | undefined,
        hala: tahdith.status as string | undefined,
        mayayir: tahdith.mayayir as string[] | undefined,
      },
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
    const huwiyya = args.huwiyya as string;

    if (!this.#wasfat) {
      return `The register is not at hand.`;
    }

    const wasfa = await this.#wasfat.iqra(huwiyya);
    if (!wasfa) return `No wasfa by that name: ${huwiyya}`;

    const ajzaa: string[] = [`## ${wasfa.huwiyya} — ${wasfa.unwan}`, ""];

    if (wasfa.hala) ajzaa.push(`**Condition:** ${wasfa.hala}`);
    if (wasfa.qadr) ajzaa.push(`**Measure:** ${wasfa.qadr}`);
    if (wasfa.wasm?.length) ajzaa.push(`**Marks:** ${wasfa.wasm.join(", ")}`);
    if (wasfa.ab) ajzaa.push(`**Under:** ${wasfa.ab}`);
    ajzaa.push("");

    if (wasfa.matn) ajzaa.push("## Statement", wasfa.matn, "");

    if (wasfa.mayayir?.length) {
      ajzaa.push("## Maʿāyīr al-Ṣafāʾ — the fire this must withstand", "");
      for (const m of wasfa.mayayir) ajzaa.push(`- \`${m}\``);
      ajzaa.push("", "Put the matter to them with mun_safa before mun_fasl.", "");
    }

    const alaqat = await this.#wasfat.alaqat(wasfa.huwiyya);
    if (alaqat.yamnaa.length || alaqat.mamnu.length) {
      ajzaa.push("## Bindings");
      if (alaqat.yamnaa.length) ajzaa.push(`**Holds back:** ${alaqat.yamnaa.join(", ")}`);
      if (alaqat.mamnu.length) ajzaa.push(`**Held by:** ${alaqat.mamnu.join(", ")}`);
      ajzaa.push("");
    }

    const hala = qiraStatus(wasfa.huwiyya);
    ajzaa.push("## Working", `**State:** ${hala ? hala.status : "not begun"}`);

    return ajzaa.join("\n");
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

  #aalijShahada(args: Record<string, unknown>): string {
    const call: NidaShahada = {
      tool: "mun_shahada",
      huwiyyatWasfa: args.huwiyyatWasfa as string,
      naw: args.naw as NidaShahada["naw"],
      natijat: args.natijat as NidaShahada["natijat"],
      rabit: args.rabit as string | undefined,
      huwiyya: args.huwiyya as string | undefined,
      khata: args.khata as string | undefined,
    };
    this.#hawwilLiKhadim(call);
    return `Testimony recorded for ${call.huwiyyatWasfa}. Your duty is done.`;
  }

  #hawwilLiKhadim(call: MunToolCall): void {
    const huwiyyatMurshid = "huwiyyatMurshid" in call
      ? (call as { huwiyyatMurshid?: string }).huwiyyatMurshid
      : undefined;

    adkhalaHadath("pm", call.tool, call as unknown as Record<string, unknown>, huwiyyatMurshid);
  }

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
}
