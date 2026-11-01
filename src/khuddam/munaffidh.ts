/**
 * Munaffidh (منفذ) — The Executor
 *
 * One of the sacred Khuddām (خدّام) of Iksīr.
 *
 * When a Murshid speaks a nidā — a tool call — it is inscribed
 * as a hadath in the Sijill's ahdath table. Munaffidh watches the
 * ahdath table on a heartbeat. When an unprocessed hadath appears,
 * Munaffidh reads the nidā, works the matter or the register, and returns
 * the natija to the Murshid's vessel.
 *
 * Munaffidh is the bridge between intention and reality.
 * The hands that turn the Murshid's words into action.
 */

import type { RasulKharij } from "../types.ts";
import type { SijillWasfat, Wasfa } from "../wasfa/sijill-wasfat.ts";
import { NtfyClient } from "../rasul/ntfy.ts";
import { Wasila } from "../hum/wasila.ts";
import { logger } from "../logging/logger.ts";
import { 
  jalabaAhdathGhairMuaalaja, 
  allamaHadathMuaalaj,
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
  NidaTabligh,
  NidaRadd,
  NidaTanazal,
  NidaTalabTahakkum,
  NidaSafa,
  NidaShahada,
  NidaFasl,
} from "../types.ts";
import { mayyazaTanbih } from "./mumayyiz.ts";
import type { MudirJalasat } from "./katib.ts";
import type { Munadi } from "./munadi.ts";
import type { Sayrafi } from "./sayrafi.ts";

interface MunaffidhDeps {
  tasmim: TasmimIksir;
  wasfat: SijillWasfat;
  rasul: RasulKharij;
  ntfy: NtfyClient;
  mudirJalasat: MudirJalasat;
  amil: Wasila;
  sayrafi: Sayrafi;
}

export class Munaffidh {
  readonly #config: TasmimIksir;
  #wasfat: SijillWasfat;
  #messenger: RasulKharij;
  #ntfy: NtfyClient;
  #sessionManager: MudirJalasat;
  #amil: Wasila;
  #sayrafi: Sayrafi;
  #iksir: Munadi | null = null;

  #mutahakkimIlgha: AbortController | null = null;

  constructor(deps: MunaffidhDeps) {
    this.#config = deps.tasmim;
    this.#wasfat = deps.wasfat;
    this.#messenger = deps.rasul;
    this.#ntfy = deps.ntfy;
    this.#sessionManager = deps.mudirJalasat;
    this.#amil = deps.amil;
    this.#sayrafi = deps.sayrafi;
  }

  wadaaMunadi(iksir: Munadi): void {
    this.#iksir = iksir;
  }

  get tasmim(): TasmimIksir {
    return this.#config;
  }

  async hammalaHala(): Promise<void> {
    await logger.akhbar("tool-executor", "State managed by SQLite (no offset to load)");
  }

  async hafizaHala(): Promise<void> {
  }

  async badaaMuaalaja(signal: AbortSignal): Promise<void> {
    this.#mutahakkimIlgha = new AbortController();
    const combinedSignal = AbortSignal.any([signal, this.#mutahakkimIlgha.signal]);

    while (!combinedSignal.aborted) {
      try {
        await this.aalajAhdath();
      } catch (error) {
        if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") {
          await logger.sajjalKhata("tool-executor", "Event processing error", {
            error: String(error),
          });
        }
      }
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  awqafMuaalaja(): void {
    this.#mutahakkimIlgha?.abort();
    this.#mutahakkimIlgha = null;
  }

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

  async aalajHadath(event: MunToolCall): Promise<void> {
    await logger.tatbeeq("tool-executor", `Processing: ${event.tool}`);

    let result: string;

    try {
      switch (event.tool) {
        case "mun_khalaq_wasfa":
          result = await this.#aalajaKhalqWasfa(event);
          break;
        case "mun_jaddid_wasfa":
          result = await this.#aalajaTajdidWasfa(event);
          break;
        case "mun_wadaa_alaqat":
          result = await this.aalajAlaqat(event);
          break;

        case "mun_balligh":
          result = await this.aalajTanbih(event);
          break;
        case "mun_radd":
          result = await this.aalajRadd(event);
          break;
        case "mun_sajjal_qarar":
          return;
        case "mun_shahada":
          await this.aalajShahada(event);
          return;
        case "mun_tanazal":
          result = await this.aalajTanazul(event);
          break;
        case "mun_talab_tahakkum":
          result = await this.aalajTalabTahakkum(event);
          break;
        case "mun_safa":
          result = await this.aalajSafa(event);
          break;
        case "mun_fasl":
          result = await this.aalajFasl(event);
          break;
        default:
          result = `Unknown tool: ${(event as { tool: string }).tool}`;
      }

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

  async #aalajaKhalqWasfa(call: NidaKhalqWasfa): Promise<string> {
    const wasfa = await this.#wasfat.khalaq({
      huwiyya: call.huwiyya,
      unwan: call.unwan,
      matn: call.wasf,
      qadr: call.taqdir,
      hala: call.hala,
      wasm: call.wasamat,
      ab: call.huwiyyatAb,
      mayayir: call.mayayir,
    });

    return `Wasfa inscribed.

**Name:** ${wasfa.huwiyya}
**Says:** ${wasfa.unwan}
**Condition:** ${wasfa.hala ?? "khaam"}
**Fire:** ${wasfa.mayayir?.length ? `${wasfa.mayayir.length} maʿāyīr` : "none declared — mun_safa cannot assay it until mun_jaddid_wasfa gives it one"}

Bind it to others with mun_wadaa_alaqat.`;
  }

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
    if (call.updates.mayayir) taghyir.mayayir = call.updates.mayayir;

    await this.#wasfat.jaddid(issue.huwiyya, taghyir);

    return `Wasfa altered: ${call.huwiyyatWasfa}

Updated fields: ${Object.entries(call.updates).filter(([, v]) => v !== undefined).map(([k]) => k).join(", ")}`;
  }

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

  async aalajTanbih(call: NidaTabligh): Promise<string> {
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

  async aalajTanazul(call: NidaTanazal): Promise<string> {
    if (!this.#iksir) {
      return "Error: Munadi not tahyiad.";
    }

    const yielderId = call.huwiyyatMurshid;
    const activeEpicId = this.#iksir.hawiyyaFaila();

    if (!this.#sessionManager.jalabMurshid(yielderId)) {
      await logger.haDHHir("tool-executor", `Yield from ${yielderId}, which holds no vessel`);
      return `Cannot yield: you (${yielderId}) hold no vessel.`;
    }

    const newStatus = call.sabab === "masdud" ? "masdud" : "muntazir";
    await this.#sessionManager.jaddadaḤalatMurshid(yielderId, newStatus, call.tafasil);

    await logger.akhbar("tool-executor", `Murshid ${yielderId} yielded: ${call.sabab}`, {
      details: call.tafasil,
      suggestNext: call.iqtarahTali,
    });

    if (yielderId !== activeEpicId) {
      await logger.akhbar("tool-executor", `${yielderId} yielded without holding the flame (active: ${activeEpicId ?? "none"})`);
      return `Recorded: you are ${newStatus}. Control was not yours to yield — the active murshid is ${activeEpicId ?? "none"}.`;
    }

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

    const murshidun = this.#sessionManager.wajadaJalasatMurshid();
    const idleSessions = murshidun.filter(
      (o) => o.huwiyya !== yielderId && o.hala === "sakin"
    );

    if (idleSessions.length > 0) {
      const msg = `${yielderId} yielded (${call.sabab}). ${idleSessions.length} idle session(s) available:\n${idleSessions.map(s => `• ${s.huwiyya}`).join("\n")}`;
      await this.#messenger.send("dispatch", msg);
      return `Yielded control. ${idleSessions.length} idle session(s) available. Al-Kimyawi can /switch to one.`;
    }

    this.#iksir.wadaaJalsaFaila(null);

    await this.#messenger.send("dispatch", `${yielderId} yielded (${call.sabab}). No other sessions available — system idle.`);

    return `Yielded control. No other sessions available. System is idle.`;
  }

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

  async aalajSafa(call: NidaSafa): Promise<string> {
    const wasfa = await this.#wasfat.iqra(call.huwiyyatWasfa);
    if (!wasfa) return `No wasfa by that name: ${call.huwiyyatWasfa}`;

    if (!wasfa.mayayir?.length) {
      return `${wasfa.huwiyya} declares no maʿāyīr al-ṣafāʾ. ` +
        `A waṣfa without a fire cannot be assayed — state them with mun_jaddid_wasfa first.`;
    }

    const far = this.#sessionManager.jalabMurshid(call.huwiyyatMurshid)?.far;
    return await this.#sayrafi.assa(wasfa, far);
  }

  async aalajFasl(call: NidaFasl): Promise<string> {
    const wasfa = await this.#wasfat.iqra(call.huwiyyatWasfa);
    if (!wasfa) return `No wasfa by that name: ${call.huwiyyatWasfa}`;

    if (wasfa.hala !== "safi") {
      return `Faṣl refused: ${wasfa.huwiyya} has not withstood its fire. Run mun_safa first.`;
    }

    const far = this.#sessionManager.jalabMurshid(call.huwiyyatMurshid)?.far;
    return await this.#sayrafi.qaddama(wasfa, far, { unwan: call.unwan, matn: call.matn, musawwada: call.musawwada });
  }

  async aalajShahada(call: NidaShahada): Promise<string> {
    const wasfa = await this.#wasfat.iqra(call.huwiyyatWasfa);
    if (!wasfa) return `No wasfa by that name: ${call.huwiyyatWasfa}`;

    const radd = call.naw === "safa"
      ? await this.#shahadatSafa(wasfa, call)
      : call.naw === "fasl"
      ? await this.#shahadatFasl(wasfa, call)
      : await this.#shahadatNaqsh(wasfa, call);
    await this.#sayrafi.intaha(wasfa.huwiyya);
    return radd;
  }

  async #shahadatSafa(wasfa: Wasfa, call: NidaShahada): Promise<string> {
    const natijat = call.natijat ?? [];
    const ihtaraq = natijat.filter((n) => n.kharaja !== 0);
    const kull = wasfa.mayayir?.length ?? 0;
    const thabata = !call.khata && natijat.length === kull && ihtaraq.length === 0;

    let risala: string;
    if (thabata) {
      await this.#wasfat.jaddid(wasfa.huwiyya, { hala: "safi" });
      risala = `The matter stood. All ${kull} maʿāyīr withstood.\n\n${wasfa.huwiyya} is ṣāfī. You may now perform faṣl.`;
    } else {
      const burned = ihtaraq
        .map((b) => `- \`${b.mayar}\` → exit ${b.kharaja}\n  ${b.qawl.split("\n").slice(-6).join("\n  ")}`)
        .join("\n\n");
      risala = `The matter did not stand.\n\nWithstood: ${natijat.length - ihtaraq.length} of ${kull}\n` +
        (burned ? `Burned away:\n\n${burned}\n\n` : "") +
        (call.khata ? `The ṣayrafī says: ${call.khata}\n\n` : "") +
        `Return to the būṭaqa.`;
    }

    await this.#ablighMurshid(wasfa.huwiyya, `## Ṣafāʾ: ${wasfa.huwiyya}\n\n${risala}`);
    return risala;
  }

  async #shahadatFasl(wasfa: Wasfa, call: NidaShahada): Promise<string> {
    if (call.khata || !call.rabit) {
      const risala = `The jawhar could not be set down. ${call.khata ?? ""}`.trim();
      await this.#ablighMurshid(wasfa.huwiyya, `## Faṣl: ${wasfa.huwiyya}\n\n${risala}`);
      return risala;
    }

    await this.#wasfat.jaddid(wasfa.huwiyya, { hala: "mafsul" });
    await this.#messenger.arsalaMunassaq(
      "kimyawi",
      `**${wasfa.huwiyya}** — ${wasfa.unwan}\n\n` +
        `It withstood its fire and has been decanted.\n\n` +
        `It stands at: ${call.rabit}\n\n` +
        `Inscribe it with \`/naqsh ${wasfa.huwiyya}\`, or say what you will of it.`,
    );
    const risala = `Decanted. ${call.huwiyya ?? wasfa.huwiyya} stands before al-Kimyawī at ${call.rabit}.\n\n` +
      `Naqsh is not yours to perform.`;
    await this.#ablighMurshid(wasfa.huwiyya, `## Faṣl: ${wasfa.huwiyya}\n\n${risala}`);
    return risala;
  }

  async #shahadatNaqsh(wasfa: Wasfa, call: NidaShahada): Promise<string> {
    if (call.khata) {
      const risala = `The codex would not take ${wasfa.huwiyya}. ${call.khata}`;
      await this.#messenger.arsalaMunassaq("dispatch", risala);
      return risala;
    }

    await this.#wasfat.jaddid(wasfa.huwiyya, { hala: "manqush" });
    const risala = `${wasfa.huwiyya} is inscribed${call.rabit ? ` (${call.rabit})` : ""}. It is canon now.`;
    await this.#messenger.arsalaMunassaq("dispatch", risala);
    await this.#ablighMurshid(wasfa.huwiyya, `## Naqsh: ${wasfa.huwiyya}\n\n${risala}`);
    return risala;
  }

  async #ablighMurshid(huwiyya: string, nass: string): Promise<void> {
    if (this.#sessionManager.jalabMurshid(huwiyya)) {
      await this.#sessionManager.arsalaIlaMurshidById(huwiyya, nass);
    } else {
      await this.#messenger.arsalaMunassaq("dispatch", nass);
    }
  }
}

export function istadaaMunaffidh(deps: MunaffidhDeps): Munaffidh {
  return new Munaffidh(deps);
}
