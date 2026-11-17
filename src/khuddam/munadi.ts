/**
 * Al-Munādī (المنادي) — the Herald at the Gate
 *
 * One of the Khuddām. Every word spoken in Dispatch is his to hear and his to
 * answer, in his own voice: each message goes into his one session on the
 * munadi bee with a short ledger of the house — what is in focus, who holds
 * the flame, who else labours — and comes back as speech. His hands are
 * instruments of his own: divine the waṣfa behind words (mun_arrif), summon
 * a murshid (mun_istadi), pass the flame (mun_hawwil), whisper to a murshid
 * (mun_ablagh_murshid), see who labours (mun_man_yaamal), read a decanted
 * codex (mun_naqsh). Inscribing he shares with the murshidūn.
 *
 * Only one murshid holds the flame at a time. Al-Munādī keeps that law: when
 * it passes, the one who held it is told to stop and waits idle in its
 * vessel; the one who takes it is told the matter is its own.
 */

import { logger } from "../logging/logger.ts";
import type { MudirJalasat } from "./katib.ts";
import type { Wasila } from "../hum/wasila.ts";
import type { AlatAlIksir } from "../alat/alat-al-iksir.ts";
import type { Sayrafi } from "./sayrafi.ts";
import type { SijillWasfat } from "../wasfa/sijill-wasfat.ts";
import type { JalsatMurshid, NawMurshid, RasulKharij } from "../types.ts";

export type InboundSource = "telegram" | "cli" | "pr_comment";

export interface RisalaWarida {
  source: InboundSource;
  text: string;
  messageId?: string | number;
  katib?: string;
}

export interface NatijaIrsal {
  tuulija: boolean;
  radd?: string;
  khata?: string;
}

interface Tarkiz {
  huwiyya: string;
  unwan: string;
  mundhu: Date;
}

interface MunadiDeps {
  mudirJalasat: MudirJalasat;
  rasul: RasulKharij;
  amil: Wasila;
  alat: AlatAlIksir;
  wasfat: SijillWasfat;
  sayrafi?: Sayrafi;
}

const JALSAT_MAJLIS = "iksir-munadi";
const UMR_TARKIZ_MS = 30 * 60 * 1000;
const MUHLAT_QAWL_MS = 150_000;
const NAMAT_ISM = /^[A-Z]+-[A-Za-z0-9_-]+$/i;

export class Munadi {
  readonly mudirJalasat: MudirJalasat;
  readonly rasul: RasulKharij;
  readonly amil: Wasila;
  readonly #alat: AlatAlIksir;
  readonly #wasfat: SijillWasfat;
  readonly #sayrafi?: Sayrafi;

  huwiyyaFaaila: string | null = null;
  faailMundhu: Date | null = null;
  #tarkiz: Tarkiz | null = null;
  #sidMajlis: string | null = null;
  #qufl: Promise<void> = Promise.resolve();

  constructor(deps: MunadiDeps) {
    this.mudirJalasat = deps.mudirJalasat;
    this.rasul = deps.rasul;
    this.amil = deps.amil;
    this.#alat = deps.alat;
    this.#wasfat = deps.wasfat;
    this.#sayrafi = deps.sayrafi;
    this.#sajjilAlat();
  }

  rakkiz(wasfa: { huwiyya: string; unwan: string }): void {
    this.#tarkiz = { huwiyya: wasfa.huwiyya, unwan: wasfa.unwan, mundhu: new Date() };
  }

  hawiyyaFaila(): string | null {
    return this.huwiyyaFaaila;
  }

  wadaaJalsaFaila(huwiyya: string | null): void {
    this.huwiyyaFaaila = huwiyya;
    this.faailMundhu = huwiyya ? new Date() : null;
    this.mudirJalasat.wadaaMurshidFaail(huwiyya);
    void logger.akhbar("munadi", `The flame is with ${huwiyya ?? "no one"}`);
  }

  async aalajRisalaIrsal(msg: RisalaWarida): Promise<NatijaIrsal> {
    return this.#tahtaQufl(async () => {
      const nass = msg.text.trim();
      if (!nass) return { tuulija: true };
      const jawab = await this.#qul(`${this.#daftar()}\n\nAl-Kimyawī says:\n${nass}`);
      return jawab ? { tuulija: true, radd: jawab } : { tuulija: true, khata: "The nest did not answer." };
    });
  }

  async #tahtaQufl<T>(fn: () => Promise<T>): Promise<T> {
    let iftah: () => void = () => {};
    const sabiq = this.#qufl;
    this.#qufl = new Promise<void>((r) => { iftah = r; });
    await sabiq;
    try {
      return await fn();
    } finally {
      iftah();
    }
  }

  #daftar(): string {
    const sutur = ["## The house, now"];
    if (this.#tarkiz && Date.now() - this.#tarkiz.mundhu.getTime() < UMR_TARKIZ_MS) {
      sutur.push(`In focus: ${this.#tarkiz.huwiyya} — ${this.#tarkiz.unwan}`);
    } else {
      this.#tarkiz = null;
      sutur.push("In focus: nothing yet");
    }
    const murshidun = this.mudirJalasat.wajadaJalasatMurshid();
    sutur.push(`Cells iksir holds in the nest: ${this.amil.khalaya()} (a nurse holds 8 unless its hive config says more; a murshid takes one, its ṣāniʿ another)`);
    sutur.push(this.huwiyyaFaaila ? `The flame: ${this.huwiyyaFaaila}` : "The flame: no one holds it");
    if (murshidun.length === 0) sutur.push("Murshidūn: none labour");
    else for (const m of murshidun) sutur.push(`- ${m.huwiyya} — ${m.unwan} (${m.hala}${m.huwiyya === this.huwiyyaFaaila ? ", the flame" : ""}) in ${m.far} · ${this.#halDawr(m.id)}`);
    return sutur.join("\n");
  }

  #halDawr(sid: string): string {
    const dawr = this.amil.akhirDawr(sid);
    const waqt = dawr.zaman ? new Date(dawr.zaman).toISOString().slice(11, 16) : null;
    if (dawr.maftuh) return "a turn is open now";
    if (!waqt) return "no turn yet";
    return dawr.khata ? `last turn broke off at ${waqt}: ${dawr.khata}` : `last turn whole at ${waqt}`;
  }

  async #qul(nass: string): Promise<string | null> {
    for (let marra = 0; marra < 2; marra++) {
      if (!this.#sidMajlis) {
        const jalsa = await this.amil.khalaqaJalsa(JALSAT_MAJLIS, "Iksir Majlis");
        if (!jalsa) return null;
        this.#sidMajlis = jalsa.id;
      }
      const sid = this.#sidMajlis;
      const jawab = await this.amil.sendPrompt(sid, nass, { agent: "iksir-munadi", timeoutMs: MUHLAT_QAWL_MS });
      if (jawab.success && jawab.response) return jawab.response;
      if (jawab.error?.includes("timed out")) {
        await this.amil.abortSession(sid);
        await logger.haDHHir("munadi", "Took too long to answer; the turn was stopped");
        return "I took too long and stopped myself; say it again.";
      }
      this.#sidMajlis = null;
    }
    return null;
  }

  #sajjilAlat(): void {
    const sijill = this.#alat.sijill;
    const khass = "munadi";

    sijill.sajjil(
      {
        name: "mun_arrif",
        khass,
        description: "Divine the waṣfa behind words: search the Sijill by name or by what it says. Use it before saying nothing exists.",
        inputSchema: { type: "object", properties: { kalimat: { type: "string", description: "A name (W-13, GH-9) or words from the title or statement" } }, required: ["kalimat"] },
      },
      (args) => this.#arrif(String(args.kalimat)),
    );

    sijill.sajjil(
      {
        name: "mun_istadi",
        khass,
        description: "Summon a murshid for a waṣfa and hand it the flame; or open a sandbox for freeform work. The answer is the deed.",
        inputSchema: {
          type: "object",
          properties: {
            huwiyya: { type: "string", description: "The waṣfa's name in the Sijill" },
            warsha: { type: "string", description: "Instead of a waṣfa: a sandbox name, letters, digits and dashes" },
          },
        },
      },
      (args) => this.#istadi(args.huwiyya as string | undefined, args.warsha as string | undefined),
    );

    sijill.sajjil(
      {
        name: "mun_hawwil",
        khass,
        description: "Pass the flame to a murshid that already labours. The one holding it is told to stop and waits.",
        inputSchema: { type: "object", properties: { huwiyya: { type: "string", description: "The murshid's waṣfa" } }, required: ["huwiyya"] },
      },
      async (args) => {
        const natija = await this.hawwil(String(args.huwiyya));
        return natija.khata ?? natija.radd ?? `The flame is with ${args.huwiyya}.`;
      },
    );

    sijill.sajjil(
      {
        name: "mun_ablagh_murshid",
        khass,
        description: "Carry al-Kimyawī's words to a murshid, in its own vessel. One that does not hold the flame still hears, and may ask for it.",
        inputSchema: {
          type: "object",
          properties: { huwiyya: { type: "string", description: "The murshid's waṣfa" }, kalimat: { type: "string", description: "What to tell it" } },
          required: ["huwiyya", "kalimat"],
        },
      },
      async (args) => {
        const huwiyya = String(args.huwiyya);
        const wasal = await this.mudirJalasat.arsalaIlaMurshidById(huwiyya, `Al-Kimyawī says:\n\n${String(args.kalimat)}`);
        return wasal ? `Sent to ${huwiyya}; its answer, when it comes, lands in its topic.` : `No murshid labours on ${huwiyya}.`;
      },
    );

    sijill.sajjil(
      {
        name: "mun_sarrih",
        khass,
        description: "Dismiss a murshid: its vessel in the workshop stands as it is, its topic remains, but iksir forgets it — session, memory, channel — and the flame if it held it. Only on al-Kimyawī's word.",
        inputSchema: { type: "object", properties: { huwiyya: { type: "string", description: "The murshid's waṣfa" } }, required: ["huwiyya"] },
      },
      async (args) => {
        const huwiyya = String(args.huwiyya).toUpperCase();
        const kanaFaail = this.huwiyyaFaaila === huwiyya;
        const jalsa = await this.mudirJalasat.sarrih(huwiyya);
        if (!jalsa) return `No murshid labours on ${huwiyya}.`;
        if (kanaFaail) this.wadaaJalsaFaila(null);
        return `The murshid of ${huwiyya} is dismissed. Its vessel \`${jalsa.far}\` stands in the workshop as it was; its topic remains.${kanaFaail ? " The flame is with no one." : ""}`;
      },
    );

    sijill.sajjil(
      {
        name: "mun_man_yaamal",
        khass,
        description: "Who labours: every murshid, its waṣfa, its condition, its vessel, and who holds the flame.",
        inputSchema: { type: "object", properties: {} },
      },
      () => this.#manYaamal(),
    );

    sijill.sajjil(
      {
        name: "mun_naqsh",
        khass,
        description: "Read the codex al-Ṣayrafī inscribed for a decanted waṣfa.",
        inputSchema: { type: "object", properties: { huwiyya: { type: "string", description: "The waṣfa's name" } }, required: ["huwiyya"] },
      },
      (args) => this.#naqsh(String(args.huwiyya)),
    );
  }

  async #arrif(kalimat: string): Promise<string> {
    const nass = kalimat.trim();
    const bilIsm = NAMAT_ISM.test(nass) ? await this.#wasfat.iqra(nass.toUpperCase()) : null;
    const wasfat = bilIsm ? [bilIsm] : await this.#wasfat.bahath(nass, 10);
    if (wasfat.length === 0) return `The Sijill holds nothing for "${nass}".`;
    return wasfat
      .map((w) => {
        const murshid = this.mudirJalasat.jalabMurshid(w.huwiyya);
        const yaamal = murshid ? ` · a murshid labours on it (${murshid.hala}${w.huwiyya === this.huwiyyaFaaila ? ", holds the flame" : ""})` : "";
        return `${w.huwiyya} — ${w.unwan} (${w.hala ?? "khaam"})${yaamal}`;
      })
      .join("\n");
  }

  async #istadi(huwiyya?: string, warsha?: string): Promise<string> {
    if (warsha) {
      const ism = warsha.toLowerCase().replace(/[^a-z0-9_-]/g, "-");
      const natija = await this.#khalaqaWaFailaMurshid(`SANDBOX-${ism}`, `Sandbox: ${ism}`, "sandbox");
      return natija.khata ?? natija.radd ?? "";
    }
    if (!huwiyya) return "Name a waṣfa, or a sandbox.";
    const wasfa = await this.#wasfat.iqra(huwiyya.toUpperCase());
    if (!wasfa) return `No waṣfa named ${huwiyya} in the Sijill; inscribe it first.`;
    this.rakkiz(wasfa);
    const natija = await this.faaalLiWasfa(wasfa.huwiyya, wasfa.unwan);
    return natija.khata ?? natija.radd ?? "";
  }

  #manYaamal(): string {
    const murshidun = this.mudirJalasat.wajadaJalasatMurshid();
    if (murshidun.length === 0) return "No murshid labours; the flame is with no one.";
    return murshidun
      .map((m) => `${m.huwiyya} — ${m.unwan} (${m.hala}${m.huwiyya === this.huwiyyaFaaila ? ", holds the flame" : ""}) in ${m.far}`)
      .join("\n");
  }

  async #naqsh(huwiyya: string): Promise<string> {
    const wasfa = await this.#wasfat.iqra(huwiyya.toUpperCase());
    if (!wasfa) return `No waṣfa named ${huwiyya} in the Sijill.`;
    if (wasfa.hala !== "mafsul") return `${wasfa.huwiyya} has not been decanted; it stands at ${wasfa.hala ?? "khaam"}.`;
    if (!this.#sayrafi) return "Al-Ṣayrafī is not at hand.";
    return this.#sayrafi.naqasha(wasfa, this.mudirJalasat.jalabMurshid(wasfa.huwiyya)?.far);
  }

  async faaalLiWasfa(huwiyya: string, unwan: string, siyaqZaid?: string): Promise<NatijaIrsal> {
    return this.#khalaqaWaFailaMurshid(huwiyya, unwan, "epic", siyaqZaid);
  }

  async #khalaqaWaFailaMurshid(huwiyya: string, unwan: string, naw: NawMurshid, zaid?: string): Promise<NatijaIrsal> {
    await logger.akhbar("munadi", `Summoning a murshid for ${huwiyya}`, { naw, unwan });
    const natija = await this.mudirJalasat.wajadaAwKhalaqa(huwiyya, unwan, naw, zaid);
    if (!natija) return { tuulija: true, khata: `The nest would not open a vessel for ${huwiyya}.` };

    const { session, jadida, mustarjaa, faailSabiq } = natija;
    const tahwil = await this.#naffadhaTahwil(huwiyya, session, faailSabiq, jadida);
    if (tahwil.khata) return tahwil;

    const fil = jadida ? "summoned" : mustarjaa ? "woken" : "already at work";
    const tahwilNass = faailSabiq && faailSabiq !== huwiyya ? ` The flame passed from ${faailSabiq}.` : "";
    return { tuulija: true, radd: `Murshid ${fil} for ${huwiyya} — ${unwan}; vessel \`${session.far}\`; the flame is its own; its opening is sent, and nothing is done until it speaks in its topic.${tahwilNass}` };
  }

  async hawwil(huwiyya: string): Promise<NatijaIrsal> {
    const jalsa = this.mudirJalasat.jalabMurshid(huwiyya);
    if (!jalsa) return { tuulija: true, khata: `No murshid labours on ${huwiyya}.` };
    if (this.huwiyyaFaaila === huwiyya) return { tuulija: true, radd: `${huwiyya} already holds the flame.` };
    const tahwil = await this.#naffadhaTahwil(huwiyya, jalsa, this.huwiyyaFaaila);
    if (tahwil.khata) return tahwil;
    return { tuulija: true, radd: `The flame passes to ${huwiyya}.` };
  }

  async istarjaaIndaNashaat(): Promise<void> {
    const huwiyya = this.mudirJalasat.wajadaMurshidFaailId();
    if (!huwiyya) {
      await logger.akhbar("munadi", "No murshid held the flame when we last slept");
      return;
    }
    const jalsa = this.mudirJalasat.jalabMurshid(huwiyya);
    if (!jalsa) {
      await logger.haDHHir("munadi", `${huwiyya} held the flame but has no vessel`);
      return;
    }
    await logger.akhbar("munadi", `Restoring the flame to ${huwiyya}`);
    await this.#naffadhaTahwil(huwiyya, jalsa, null, true);
  }

  async #naffadhaTahwil(huwiyya: string, jalsa: JalsatMurshid, sabiq: string | null, samit = false): Promise<NatijaIrsal> {
    if (sabiq === huwiyya) {
      this.wadaaJalsaFaila(huwiyya);
      return { tuulija: true };
    }
    const jalsaSabiqa = sabiq ? this.mudirJalasat.jalabMurshid(sabiq) : null;
    await logger.akhbar("munadi", `The flame passes: ${sabiq ?? "no one"} → ${huwiyya}`);

    if (jalsaSabiqa) {
      await this.mudirJalasat.jaddadaḤalatMurshid(sabiq!, "sakin");
      await this.mudirJalasat.arsalaIlaMurshidById(jalsaSabiqa.huwiyya,
        `🛑 The flame passes to ${huwiyya}. Stop now; do not touch the matter further; summon no more ṣāniʿs.\n\nYou are idle. Vessel: ${jalsaSabiqa.far} (still yours; no one else enters it). Whispers will still reach you; use \`mun_talab_tahakkum\` when you have actionable work.`);
    }

    try {
      await this.mudirJalasat.jaddadaḤalatMurshid(huwiyya, "fail");
      this.wadaaJalsaFaila(huwiyya);
    } catch (khata) {
      void logger.sajjalKhata("munadi", `Could not hand the flame to ${huwiyya}; it stays where it was`, { error: String(khata) });
      if (jalsaSabiqa) await this.mudirJalasat.jaddadaḤalatMurshid(sabiq!, "fail").catch(() => {});
      this.wadaaJalsaFaila(sabiq);
      return { tuulija: true, khata: `Could not hand the flame to ${huwiyya}: ${khata}` };
    }

    if (!samit) {
      await this.mudirJalasat.arsalaIlaMurshidById(huwiyya,
        `✅ You hold the flame${sabiq ? ` again; before you, ${sabiq}` : ""}. Vessel: ${jalsa.far} — raise it in the workshop if it is not yet there. The matter is yours.`).catch(() => {});
    }

    if (jalsaSabiqa) await this.rasul.arsalaMunassaq("dispatch", `The flame passes from ${sabiq} to **${huwiyya}**.`).catch(() => {});
    return { tuulija: true };
  }
}

export function istadaaMunadi(deps: MunadiDeps): Munadi {
  return new Munadi(deps);
}
