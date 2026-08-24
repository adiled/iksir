/**
 * Munaffidh (منفذ) — The Executor
 *
 * One of the sacred Khuddām (خدّام) of Iksīr.
 *
 * When a Murshid speaks a nidā — a tool call — it is inscribed
 * as a hadath in the Sijill's ahdath table. Munaffidh watches the
 * ahdath table on a heartbeat. When an unprocessed hadath appears,
 * Munaffidh reads the nidā, performs the sacred operation — git,
 * Linear, GitHub — and returns the natija to the Murshid's vessel.
 *
 * Munaffidh is the bridge between intention and reality.
 * The hands that turn the Murshid's words into action.
 */

import type { Fasl } from "../hayula/fasl.ts";
import type { RasulKharij } from "../types.ts";
import type { SijillWasfat, Wasfa } from "../wasfa/sijill-wasfat.ts";
import { NtfyClient } from "../notifications/ntfy.ts";
import { AmilHum } from "../hum/client.ts";
import { logger } from "../logging/logger.ts";
import { 
  jalabaAhdathGhairMuaalaja, 
  allamaHadathMuaalaj,
  qiraStatus,
  naqshStatus,
  haddathaAwAdkhalaMatlabMuallaq,
  mahaqaMatlabMuallaq,
  jalabaMatalebMuallaq,
} from "../../db/db.ts";
import type {
  TasmimIksir,
  MunToolCall,
  NidaKhalqWasfa,
  NidaTajdidWasfa,
  NidaWadaaAlaqat,
  NidaQiraatWasfa,
  NidaKhalqRisala,
  NidaFahasFar,
  NidaTabligh,
  NidaRadd,
  NidaTanazal,
  NidaTalabTahakkum,
  NidaKhalqFar,
  NidaIstihal,
  NidaIstihalMutabaqq,
  NidaIltazim,
  NidaRattib,
} from "../types.ts";
import { wallidIsmFar } from "./katib.ts";
import { mayyazaTanbih } from "./mumayyiz.ts";
import type { MudirJalasat } from "./katib.ts";
import type { Munadi } from "./munadi.ts";
import type { Hayula } from "../hayula/hayula.ts";

interface MunaffidhDeps {
  tasmim: TasmimIksir;
  wasfat: SijillWasfat;
  fasl: Fasl;
  rasul: RasulKharij;
  ntfy: NtfyClient;
  mudirJalasat: MudirJalasat;
  amil: AmilHum;
  /** The matter worked upon. Iksīr never asks what kind. */
  hayula: Hayula;
}



export class Munaffidh {
  readonly #config: TasmimIksir;
  #wasfat: SijillWasfat;
  #fasl: Fasl;
  #messenger: RasulKharij;
  #ntfy: NtfyClient;
  #sessionManager: MudirJalasat;
  #amil: AmilHum;
  #hayula: Hayula;
  #iksir: Munadi | null = null;

  #mutahakkimIlgha: AbortController | null = null;

  constructor(deps: MunaffidhDeps) {
    this.#config = deps.tasmim;
    this.#wasfat = deps.wasfat;
    this.#fasl = deps.fasl;
    this.#messenger = deps.rasul;
    this.#ntfy = deps.ntfy;
    this.#sessionManager = deps.mudirJalasat;
    this.#amil = deps.amil;
    this.#hayula = deps.hayula;
  }

  /**
   * Set Munadi (called after Munadi is created to avoid circular dep)
   */
  wadaaMunadi(iksir: Munadi): void {
    this.#iksir = iksir;
  }

  /** Access config for quiet hours checks etc. */
  get tasmim(): TasmimIksir {
    return this.#config;
  }

  /**
   * Load persisted state (call before startProcessing)
   * With SQLite, there's no offset to load - processed state is in the DB.
   */
  async hammalaHala(): Promise<void> {
    await logger.akhbar("tool-executor", "State managed by SQLite (no offset to load)");
  }

  /**
   * Save state to disk (public, for graceful ighlaaq)
   * With SQLite, processed events are already marked - nothing to persist separately.
   */
  async hafizaHala(): Promise<void> {
  }

  /**
   * Start draining the ahdath the instruments inscribe
   */
  async badaaMuaalaja(signal: AbortSignal): Promise<void> {
    this.#mutahakkimIlgha = new AbortController();
    const combinedSignal = AbortSignal.any([signal, this.#mutahakkimIlgha.signal]);

    while (!combinedSignal.aborted) {
      try {
        await this.aalajAhdath();
      } catch (error) {
        if (!(error instanceof Deno.errors.NotFound)) {
          await logger.sajjalKhata("tool-executor", "Event processing error", {
            error: String(error),
          });
        }
      }
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  /**
   * Stop processing
   */
  awqafMuaalaja(): void {
    this.#mutahakkimIlgha?.abort();
    this.#mutahakkimIlgha = null;
  }

  /**
   * Process unprocessed events from SQLite
   */
  async aalajAhdath(): Promise<void> {
    const events = jalabaAhdathGhairMuaalaja("pm");
    
    if (events.length === 0) {
      return;
    }

    for (const dbEvent of events) {
      try {
        const event = JSON.parse(dbEvent.payload) as MunToolCall & { timestamp: string };
        await this.aalajHadath(event);
        allamaHadathMuaalaj(dbEvent.id);
      } catch (error) {
        await logger.haDHHir("tool-executor", "Failed to process event", { 
          error: String(error),
          eventId: dbEvent.id,
        });
        allamaHadathMuaalaj(dbEvent.id);
      }
    }
  }

  /**
   * Handle one hadath
   */
  /** Git-mutating tools that must be blocked during session switches */
  static readonly GIT_TOOLS = new Set([
    "mun_khalaq_far", "mun_rattib", "mun_iltazim", "mun_idfa", "mun_istihal", "mun_istihal_mutabaqq",
  ]);

  async aalajHadath(event: MunToolCall): Promise<void> {
    await logger.tatbeeq("tool-executor", `Processing: ${event.tool}`);

    if (Munaffidh.GIT_TOOLS.has(event.tool) && this.#sessionManager.huwaGitMasdud()) {
      const msg = `Git operation blocked: a session switch is in progress. Try again in a few seconds.`;
      const targetId = ("huwiyyatMurshid" in event && event.huwiyyatMurshid)
        ? event.huwiyyatMurshid as string
        : null;
      if (targetId) {
        await this.#sessionManager.arsalaIlaMurshidById(targetId, `## Tool Result: ${event.tool}\n\n${msg}`);
      } else {
        await this.#sessionManager.arsalaIlaMurshid(`## Tool Result: ${event.tool}\n\n${msg}`);
      }
      return;
    }

    let result: string;

    try {
      switch (event.tool) {
        case "mun_iqra_wasfa":
          result = await this.#aalajaQiraaatWasfa(event);
          break;
        case "mun_khalaq_wasfa":
          result = await this.#aalajaKhalqWasfa(event);
          break;
        case "mun_jaddid_wasfa":
          result = await this.#aalajaTajdidWasfa(event);
          break;
        case "mun_wadaa_alaqat":
          result = await this.aalajAlaqat(event);
          break;

        case "mun_khalaq_risala":
          result = await this.#aalajaKhalqRisala(event);
          break;
        case "mun_fahas_far":
          result = await this.aalajFahsFar(event);
          break;
        case "mun_balligh":
          result = await this.aalajTanbih(event);
          break;
        case "mun_radd":
          result = await this.aalajRadd(event);
          break;
        case "mun_sajjal_qarar":
          return;
        case "mun_tanazal":
          result = await this.aalajTanazul(event);
          break;
        case "mun_talab_tahakkum":
          result = await this.aalajTalabTahakkum(event);
          break;
        case "mun_khalaq_far":
          result = await this.aalajKhalqFar(event);
          break;
        case "mun_rattib":
          result = await this.aalajGitAdd(event);
          break;
        case "mun_iltazim":
          result = await this.aalajIltizam(event);
          break;
        case "mun_idfa":
          result = await this.aalajGitPush();
          break;
        case "mun_istihal":
          result = await this.aalajIstihal(event);
          break;
        case "mun_istihal_mutabaqq":
          result = await this.aalajIstihalMutabaqq(event);
          break;
        default:
          result = `Unknown tool: ${(event as { tool: string }).tool}`;
      }

      /** Send result back to the originating murshid (not necessarily the active one) */
      const targetId = ("huwiyyatMurshid" in event && event.huwiyyatMurshid)
        ? event.huwiyyatMurshid as string
        : null;
      if (targetId) {
        await this.#sessionManager.arsalaIlaMurshidById(targetId, `## Tool Result: ${event.tool}\n\n${result}`);
      } else {
        await this.#sessionManager.arsalaIlaMurshid(`## Tool Result: ${event.tool}\n\n${result}`);
      }
    } catch (error) {
      const errorMsg = `Error executing ${event.tool}: ${error}`;
      await logger.sajjalKhata("tool-executor", errorMsg);
      const targetId = ("huwiyyatMurshid" in event && event.huwiyyatMurshid)
        ? event.huwiyyatMurshid as string
        : null;
      if (targetId) {
        await this.#sessionManager.arsalaIlaMurshidById(targetId, `## Tool Error: ${event.tool}\n\n${errorMsg}`);
      } else {
        await this.#sessionManager.arsalaIlaMurshid(`## Tool Error: ${event.tool}\n\n${errorMsg}`);
      }
    }
  }


  /**
   * Handle pm_read_wasfa
   */
  async #aalajaQiraaatWasfa(call: NidaQiraatWasfa): Promise<string> {
    const wasfa = await this.#wasfat.iqra(call.huwiyya);
    if (!wasfa) return `No wasfa by that name: ${call.huwiyya}`;

    const ajzaa: string[] = [
      `## ${wasfa.huwiyya} — ${wasfa.unwan}`,
      "",
    ];

    if (wasfa.hala) ajzaa.push(`**Condition:** ${wasfa.hala}`);
    if (wasfa.qadr) ajzaa.push(`**Measure:** ${wasfa.qadr}`);
    if (wasfa.wasm?.length) ajzaa.push(`**Marks:** ${wasfa.wasm.join(", ")}`);
    if (wasfa.ab) ajzaa.push(`**Under:** ${wasfa.ab}`);
    ajzaa.push("");

    if (wasfa.matn) {
      ajzaa.push("## Statement", wasfa.matn, "");
    }

    const alaqat = await this.#wasfat.alaqat(wasfa.huwiyya);
    if (alaqat.yamnaa.length || alaqat.mamnu.length) {
      ajzaa.push("## Bindings");
      if (alaqat.yamnaa.length) ajzaa.push(`**Holds back:** ${alaqat.yamnaa.join(", ")}`);
      if (alaqat.mamnu.length) ajzaa.push(`**Held by:** ${alaqat.mamnu.join(", ")}`);
      ajzaa.push("");
    }

    const halaTanfidh = qiraStatus(wasfa.huwiyya);
    ajzaa.push("## Working");
    ajzaa.push(`**State:** ${halaTanfidh ? halaTanfidh.status : "not begun"}`);

    return ajzaa.join("\n");
  }

  /**
   * Handle pm_create_wasfa
   */
  async #aalajaKhalqWasfa(call: NidaKhalqWasfa): Promise<string> {
    const wasfa = await this.#wasfat.khalaq({
      unwan: call.unwan,
      matn: call.wasf,
      qadr: call.taqdir,
      hala: call.hala,
      wasm: call.wasamat,
      ab: call.huwiyyatAb,
    });

    return `Wasfa inscribed.

**Name:** ${wasfa.huwiyya}
**Says:** ${wasfa.unwan}
**Condition:** ${wasfa.hala ?? "khaam"}

Bind it to others with mun_wadaa_alaqat.`;
  }

  /**
   * Handle pm_update_wasfa
   */
  async #aalajaTajdidWasfa(call: NidaTajdidWasfa): Promise<string> {
    const issue = await this.#wasfat.iqra(call.huwiyyatWasfa);
    if (!issue) {
      return `Ticket not found: ${call.huwiyyatWasfa}`;
    }

    const taghyir: Partial<Omit<Wasfa, "huwiyya">> = {};
    if (call.updates.unwan) taghyir.unwan = call.updates.unwan;
    if (call.updates.wasf) taghyir.matn = call.updates.wasf;
    if (call.updates.taqdir) taghyir.qadr = call.updates.taqdir;
    if (call.updates.hala) taghyir.hala = call.updates.hala;

    await this.#wasfat.jaddid(issue.huwiyya, taghyir);

    return `Wasfa altered: ${call.huwiyyatWasfa}

Updated fields: ${Object.keys(call.updates).join(", ")}`;
  }

  /**
   * Handle pm_set_relations
   */
  async aalajAlaqat(call: NidaWadaaAlaqat): Promise<string> {
    await logger.akhbar("tool-executor", "Setting relations", {
      huwiyyatWasfa: call.huwiyyatWasfa,
      blocks: call.yahjub,
      blockedBy: call.mahjoubBi,
    });

    await this.#wasfat.rabt(
      call.huwiyyatWasfa,
      call.yahjub,
      call.mahjoubBi
    );

    return `Relations updated for ${call.huwiyyatWasfa}.

${call.yahjub?.length ? `**Blocks:** ${call.yahjub.join(", ")}` : ""}
${call.mahjoubBi?.length ? `**Blocked by:** ${call.mahjoubBi.join(", ")}` : ""}`;
  }

  /**
   * Handle pm_create_risala
   */
  async #aalajaKhalqRisala(call: NidaKhalqRisala): Promise<string> {
    const result = await this.#fasl.qaddama({
      unwan: call.unwan,
      matn: call.matn,
      jawhar: call.ras,
      asas: call.asas,
      musawwada: true,
    });

    if (!result) {
      return `Failed to create PR for ${call.huwiyyatWasfa}. Check GitHub authentication and branch status.`;
    }

    /** Update implementation status with PR info */
    const activeOrch = this.#sessionManager.wajadaMurshidFaail();
    naqshStatus({
      huwiyyatWasfa: call.huwiyyatWasfa,
      huwiyyatMurshid: activeOrch?.huwiyya ?? "unknown",
      status: "complete",
      summary: `Jawhar ${result.huwiyya}`,
    });

    /**
     * Register PR for keepalive tracking (PR tracking)
     * This enables merge detection to trigger next PR cycle
     */
    const murshidFaail = this.#sessionManager.wajadaMurshidFaail();
    if (murshidFaail) {
      await this.#sessionManager.sajjalRisala(murshidFaail.huwiyya, {
        huwiyyatWasfa: call.huwiyyatWasfa,
        raqamRisala: Number(result.huwiyya),
        far: call.ras,
        hala: "draft",
        unshiaFi: new Date().toISOString(),
        ghuyiratHalaFi: new Date().toISOString(),
      });
    } else {
      await logger.haDHHir("tool-executor", `Jawhar ${result.huwiyya} decanted but no active murshid to tend it`);
    }

    return `Draft PR created successfully!

**Jawhar:** ${result.huwiyya}
**Where:** ${result.rabit ?? "—"}
**Title:** ${call.unwan}
**Base:** ${call.asas}
**Head:** ${call.ras}

The PR is in draft mode. It will be promoted it when ready for review.
PR is now being tracked by keepalive for merge detection.`;
  }

  /**
   * Handle pm_check_branch_status
   */
  async aalajFahsFar(call: NidaFahasFar): Promise<string> {
    const defaultBranch = await this.#hayula.asas();
    const comparison = await this.#fasl.farq(defaultBranch, call.far);

    if (!comparison) {
      return `Failed to check branch status for ${call.far}. Branch may not exist.`;
    }

    return `## Branch Status: ${call.far}

**Ahead of ${defaultBranch}:** ${comparison.amam}
**Behind ${defaultBranch}:** ${comparison.khalf}
**Matter changed:** ${comparison.ahjar}

${comparison.khalf > 0 ? "⚠️ Branch is behind - consider rebasing before PR." : "✓ Branch is up to date with main."}`;
  }

  /**
   * Handle pm_notify
   * Filters khabath notifications, routes dhahab ones to mawdu al-Kimyawi.
   */
  async aalajTanbih(call: NidaTabligh): Promise<string> {
    /** Step 1: Mayyiz the tanbih */
    const tamyiz = await mayyazaTanbih(this.#amil, call.risala);

    if (!tamyiz.dhahab) {
      await logger.akhbar("tool-executor", "Ishara rejected as khabath", {
        reason: tamyiz.sabab,
        messagePreview: call.risala.slice(0, 100),
      });

      return `REJECTED: ${tamyiz.radd}

Your message was not forwarded to al-Kimyawi. This appears to be within your autonomy.

Reason: ${tamyiz.sabab}`;
    }

    await logger.akhbar("tool-executor", "Ishara approved", {
      reason: tamyiz.sabab,
      messagePreview: call.risala.slice(0, 100),
    });

    const sent: string[] = [];

    if (this.#messenger.mumakkan()) {
      try {
        await this.#messenger.send(
          { murshid: call.huwiyyatMurshid },
          call.risala,
        );
        sent.push("messenger");
      } catch (err) {
        await logger.sajjalKhata("tool-executor", "Failed to send notification via messenger", {
          error: String(err),
        });
      }
    }

    if (this.#ntfy.mumakkan()) {
      const success = await this.#ntfy.send({
        sinf: "decision",
        unwan: "Murshid Message",
        matn: call.risala,
        awwaliyya: call.awwaliyya,
      });
      if (success) {
        sent.push("ntfy");
      }
    }

    if (sent.length === 0) {
      return "Warning: No notification channels are enabled. Message not delivered.";
    }

    return `Ishara sent to al-Kimyawi via: ${sent.join(", ")}

Awwaliyya: ${call.awwaliyya}
Message preview: ${call.risala.slice(0, 100)}${call.risala.length > 100 ? "..." : ""}`;
  }

  /**
   * Handle pm_reply
   * Direct response to al-Kimyawi's question - no filtering, just route to topic.
   * Uses fallback chain: Markdown → MarkdownV2 → plain text
   */
  async aalajRadd(call: NidaRadd): Promise<string> {
    if (!this.#messenger.mumakkan()) {
      return "Warning: Messenger not enabled. Reply not delivered.";
    }

    try {
      await this.#messenger.arsalaMunassaq(
        { murshid: call.huwiyyatMurshid },
        call.risala,
      );

      await logger.akhbar("tool-executor", "Reply sent to al-Kimyawi", {
        huwiyyatMurshid: call.huwiyyatMurshid,
        messagePreview: call.risala.slice(0, 100),
      });
      return `Reply sent to al-Kimyawi (${call.huwiyyatMurshid}).`;
    } catch (err) {
      await logger.sajjalKhata("tool-executor", "Failed to send reply to al-Kimyawi", {
        huwiyyatMurshid: call.huwiyyatMurshid,
        error: String(err),
      });
      return "Failed to send reply to al-Kimyawi.";
    }
  }

  /**
   * Handle pm_yield - murshid voluntarily yields control
   */
  async aalajTanazul(call: NidaTanazal): Promise<string> {
    if (!this.#iksir) {
      return "Error: Munadi not tahyiad.";
    }

    const yielderId = call.huwiyyatMurshid;
    const activeEpicId = this.#iksir.hawiyyaFaila();

    if (yielderId !== activeEpicId) {
      await logger.haDHHir("tool-executor", `Non-active murshid ${yielderId} tried to yield (active: ${activeEpicId})`);
      return `Cannot yield: you (${yielderId}) are not the active murshid. Active: ${activeEpicId ?? "none"}.`;
    }

    /** Update session status */
    const newStatus = call.sabab === "masdud" ? "masdud" : "muntazir";
    await this.#sessionManager.jaddadaḤalatMurshid(yielderId, newStatus, call.tafasil);

    await logger.akhbar("tool-executor", `Murshid ${yielderId} yielded: ${call.sabab}`, {
      details: call.tafasil,
      suggestNext: call.iqtarahTali,
    });

    /** Check pending demands first (persisted in SQLite, sorted by awwaliyya then time) */
    const demands = jalabaMatalebMuallaq();
    if (demands.length > 0) {
      const demand = demands[0];
      mahaqaMatlabMuallaq(demand.huwiyat_murshid);
      await logger.akhbar("tool-executor", `Processing pending demand from ${demand.huwiyat_murshid}`, {
        reason: demand.reason,
      });

      const switchResult = await this.#iksir.aalajIstijabaZirr("cli", `switch:${demand.huwiyat_murshid}`);
      if (switchResult.tuulija) {
        return `Yielded control. Switching to ${demand.huwiyat_murshid} (pending demand: ${demand.reason}).`;
      }
    }

    if (call.iqtarahTali) {
      const murshidun = this.#sessionManager.wajadaJalasatMurshid();
      const suggested = murshidun.find((o) => o.huwiyya === call.iqtarahTali);
      if (suggested && suggested.hala === "sakin") {
        await this.#iksir.aalajIstijabaZirr("cli", `switch:${call.iqtarahTali}`);
        return `Yielded control. Switching to suggested: ${call.iqtarahTali}.`;
      }
    }

    /** Check for idle sessions */
    const murshidun = this.#sessionManager.wajadaJalasatMurshid();
    const idleSessions = murshidun.filter(
      (o) => o.huwiyya !== yielderId && o.hala === "sakin"
    );

    if (idleSessions.length > 0) {
      /** Notify al-Kimyawi */
      const msg = `${yielderId} yielded (${call.sabab}). ${idleSessions.length} idle session(s) available:\n${idleSessions.map(s => `• ${s.huwiyya}`).join("\n")}`;
      await this.#messenger.send("dispatch", msg);
      return `Yielded control. ${idleSessions.length} idle session(s) available. Al-Kimyawi can /switch to one.`;
    }

    this.#iksir.wadaaJalsaFaila(null);

    await this.#messenger.send("dispatch", `${yielderId} yielded (${call.sabab}). No other sessions available — system idle.`);

    return `Yielded control. No other sessions available. System is idle.`;
  }

  /**
   * Handle pm_demand_control - murshid demands control back
   */
  async aalajTalabTahakkum(call: NidaTalabTahakkum): Promise<string> {
    if (!this.#iksir) {
      return "Error: Munadi not tahyiad.";
    }

    const demanderId = call.huwiyyatMurshid;
    const demander = this.#sessionManager.jalabMurshid(demanderId);

    if (!demander) {
      return `Cannot demand control: unknown murshid ${demanderId}.`;
    }

    const activeEpicId = this.#iksir.hawiyyaFaila();

    await logger.akhbar("tool-executor", `Murshid ${demanderId} demands control`, {
      reason: call.sabab,
      awwaliyya: call.awwaliyya,
      currentActive: activeEpicId,
    });

    if (!activeEpicId) {
      const result = await this.#iksir.aalajIstijabaZirr("cli", `switch:${demanderId}`);
      if (result.tuulija) {
        return `Control granted immediately. You are now ACTIVE.\n\nReason: ${call.sabab}`;
      }
      return "Failed to grant control.";
    }

    if (activeEpicId === demanderId) {
      return `You (${demanderId}) are already the active murshid.`;
    }

    /** Case 3: Current active is blocked/waiting — graceful snatch */
    const currentActive = this.#sessionManager.jalabMurshid(activeEpicId);
    if (currentActive && (currentActive.hala === "masdud" || currentActive.hala === "muntazir")) {
      const result = await this.#iksir.aalajIstijabaZirr("cli", `switch:${demanderId}`);
      if (result.tuulija) {
        return `Control granted (${activeEpicId} was ${currentActive.hala}). You are now ACTIVE.\n\nReason: ${call.sabab}`;
      }
      return "Failed to grant control.";
    }

    haddathaAwAdkhalaMatlabMuallaq(demanderId, call.sabab, call.awwaliyya);

    const queueLength = jalabaMatalebMuallaq().length;
    await logger.akhbar("tool-executor", `Queued demand from ${demanderId}`, {
      queueLength,
    });

    if (call.awwaliyya === "urgent") {
      await this.#messenger.send("dispatch",
        `URGENT: ${demanderId} demands control.\n\nReason: ${call.sabab}\nCurrent active: ${activeEpicId}\n\nApprove with /switch ${demanderId}`
      );

      return `Urgent demand queued and al-Kimyawi mubalagh. Current active: ${activeEpicId}.\n\nYou will be activated when ${activeEpicId} yields or al-Kimyawi yuwafiq.`;
    }

    return `Demand queued. Current active: ${activeEpicId}.\n\nYou will be activated when ${activeEpicId} yields.`;
  }


  /**
   * Handle pm_create_branch - create epic, chore, or sandbox branch
   */
  async aalajKhalqFar(call: NidaKhalqFar): Promise<string> {
    const branchName = wallidIsmFar(call.huwiyya, call.naw, call.kunya);

    await logger.akhbar("tool-executor", `Creating branch: ${branchName}`);

    if (await this.#hayula.mudtarib()) {
      return `Error: Working directory is dirty. Cannot create branch.

Please commit or stash changes first.`;
    }

    /** Checkout default branch and pull */
    const defaultBranch = await this.#hayula.asas();
    const intaqalaIlaMain = await this.#hayula.dakhala(defaultBranch);
    if (!intaqalaIlaMain) {
      return `Error: Failed to intaqalaIla ${defaultBranch} branch.`;
    }

    await this.#hayula.sahaba(defaultBranch);

    /** Create new branch */
    const intaqalaIlaNew = await this.#hayula.dakhala(branchName);
    if (!intaqalaIlaNew) {
      return `Error: Failed to create branch ${branchName}.`;
    }

    /** Push with -u */
    const pushed = await this.#hayula.azhara?.(branchName, true);
    if (!pushed) {
      return `Branch created locally but failed to push.

Branch: ${branchName}

Try: git push -u origin ${branchName}`;
    }

    /** Update session with branch name */
    const session = this.#sessionManager.jalabMurshid(call.huwiyya);
    if (session) {
      session.far = branchName;
      await this.#sessionManager.hafizaHala();
    }

    return `Branch created and pushed successfully.

Branch: ${branchName}
Status: Checked out and tracking origin

You can now start implementation.`;
  }

  /**
   * Rattib — choose which matter is to be fixed.
   *
   * Some hayūlā keep a staging ground between the molten and the fixed;
   * most do not. Iksīr does not pretend to one. The choice is acknowledged
   * here and carried into the fixing itself, where thabbata takes the same
   * list. Nothing is done to the matter yet.
   */
  aalajGitAdd(call: NidaRattib): Promise<string> {
    return Promise.resolve(
      `Chosen for fixing (${call.ahjar.length}):\n${call.ahjar.map((f) => `  · ${f}`).join("\n")}\n\n` +
        `Nothing is fixed until mun_iltazim.`,
    );
  }

  /**
   * Handle pm_commit - commit staged changes
   */
  async aalajIltizam(call: NidaIltazim): Promise<string> {
    const najah = await this.#hayula.thabbata(call.risala, call.ahjar);
    if (!najah) {
      return `The matter would not be fixed. It may already be settled, or nothing was molten.`;
    }

    return `Matter fixed into the vessel.

Reason: ${call.risala}`;
  }

  /**
   * Handle pm_git_push - push current branch
   */
  async aalajGitPush(): Promise<string> {
    const currentBranch = await this.#hayula.waqif();
    if (!currentBranch) {
      return `Error: Could not determine current branch.`;
    }

    const pushed = await this.#hayula.azhara?.(currentBranch);
    if (!pushed) {
      return `Error: Failed to push ${currentBranch} to origin.`;
    }

    return `Pushed successfully.

Branch: ${currentBranch}
Remote: origin`;
  }

  /**
   * Handle mun_istihal - transmute ahjar from buwtaqa into jawhar
   */
  async aalajIstihal(call: NidaIstihal): Promise<string> {
    await logger.akhbar("tool-executor", `Istihal for ${call.huwiyyatWasfa}`, {
      ahjar: call.ahjar.length,
    });

    const jawharBranch = wallidIsmFar(call.huwiyyatWasfa, "chore");

    const result = await this.#hayula.istahala(jawharBranch, call.ahjar);

    if (!result.najah) {
      if (result.nawKhata === "taarud" && result.taarudat) {
        return `Istihal failed: Ahjar conflict with codex.

Conflicted ahjar:
${result.taarudat.map((f) => `  - ${f}`).join("\n")}

To resolve:
1. Reconcile the conflicting ahjar in buwtaqa, then retry mun_istihal
2. git status to identify conflicts
3. Resolve, git add, git commit`;
      }
      return `Istihal failed (${result.nawKhata}): ${result.khata}`;
    }

    return `Istihal complete.

Jawhar: ${jawharBranch}
Buwtaqa: ${result.buwtaqa}
Ahjar transmuted: ${result.adadAhjar}

Next: Use mun_fasl to create the risala.`;
  }

  /**
   * Handle mun_istihal_mutabaqq - layered istihal targeting parent jawhar
   */
  async aalajIstihalMutabaqq(call: NidaIstihalMutabaqq): Promise<string> {
    await logger.akhbar("tool-executor", `Layered istihal for ${call.huwiyyatWasfa}`, {
      parentTicketId: call.huwiyyatAbWasfa,
      ahjar: call.ahjar.length,
    });

    const jawharBranch = wallidIsmFar(call.huwiyyatWasfa, "chore");
    const parentJawhar = wallidIsmFar(call.huwiyyatAbWasfa, "chore");

    const result = await this.#hayula.istahala(jawharBranch, call.ahjar, parentJawhar);

    if (!result.najah) {
      if (result.nawKhata === "taarud" && result.taarudat) {
        return `Layered istihal failed: Conflicts with codex.

Conflicted ahjar:
${result.taarudat.map((f) => `  - ${f}`).join("\n")}

Resolve conflicts in buwtaqa before retrying.`;
      }
      return `Layered istihal failed (${result.nawKhata}): ${result.khata}`;
    }

    const codex = await this.#hayula.asas();

    return `Layered istihal complete.

Jawhar: ${jawharBranch}
Parent jawhar: ${parentJawhar}
Buwtaqa: ${result.buwtaqa}
Ahjar transmuted: ${result.adadAhjar}

Next: Use mun_fasl to create the risala (base on parent jawhar).

NOTE: Risala may be unstable until parent jawhar inscribes.
When parent inscribes, use mun_istihal to re-transmute onto ${codex}.`;
  }
}

/**
 * Create an IPC processor instance
 */
export function istadaaMunaffidh(deps: MunaffidhDeps): Munaffidh {
  return new Munaffidh(deps);
}
