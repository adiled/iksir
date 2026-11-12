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
    sutur.push(this.huwiyyaFaaila ? `The flame: ${this.huwiyyaFaaila}` : "The flame: no one holds it");
    if (murshidun.length === 0) sutur.push("Murshidūn: none labour");
    else for (const m of murshidun) sutur.push(`- ${m.huwiyya} — ${m.unwan} (${m.hala}${m.huwiyya === this.huwiyyaFaaila ? ", the flame" : ""}) in ${m.far}`);
    return sutur.join("\n");
  }

  async #qul(nass: string): Promise<string | null> {
    for (let marra = 0; marra < 2; marra++) {
      if (!this.#sidMajlis) {
        const jalsa = await this.amil.khalaqaJalsa(JALSAT_MAJLIS, "Iksir Majlis");
        if (!jalsa) return null;
        this.#sidMajlis = jalsa.id;
      }
      const jawab = await this.amil.sendPrompt(this.#sidMajlis, nass, { agent: "iksir-munadi", timeoutMs: 120_000 });
      if (jawab.success && jawab.response) return jawab.response;
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
        return wasal ? `Told ${huwiyya}.` : `No murshid labours on ${huwiyya}.`;
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
      const natija = await this.#khalaqaWaFailaMurshid(`SANDBOX-${ism}`, `Sandbox: ${ism}`, "sandbox",
        `A sandbox is open for you: **${ism}**, vessel \`sandbox/${ism}\`. Freeform work — no waṣfa, no PR demanded. Brainstorm, prototype, experiment. When it should become waṣfāt, tell al-Kimyawī.`);
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
    const zaid = siyaqZaid ? `\n\n${siyaqZaid}` : "";
    return this.#khalaqaWaFailaMurshid(huwiyya, unwan, "epic",
      `You are set to work on **${huwiyya}** — ${unwan}.${zaid}\n\nRead it with \`mun_iqra_wasfa\`, learn what the matter is before you touch it,\nthen draft your khuṭṭa.`);
  }

  async #khalaqaWaFailaMurshid(huwiyya: string, unwan: string, naw: NawMurshid, tasis: string): Promise<NatijaIrsal> {
    await logger.akhbar("munadi", `Summoning a murshid for ${huwiyya}`, { naw, unwan });
    const natija = await this.mudirJalasat.wajadaAwKhalaqa(huwiyya, unwan, naw);
    if (!natija) return { tuulija: true, khata: `The nest would not open a vessel for ${huwiyya}.` };

    const { session, jadida, mustarjaa, faailSabiq } = natija;
    const tahwil = await this.#naffadhaTahwil(huwiyya, session, faailSabiq);
    if (tahwil.khata) return tahwil;

    if (jadida) await this.mudirJalasat.arsalaIlaMurshid(tasis);
    else if (mustarjaa) await this.mudirJalasat.arsalaIlaMurshid(`Resuming. You were at work on: ${unwan}`);

    const fil = jadida ? "summoned" : mustarjaa ? "woken" : "already at work";
    const tahwilNass = faailSabiq && faailSabiq !== huwiyya ? ` The flame passed from ${faailSabiq}.` : "";
    return { tuulija: true, radd: `Murshid ${fil} for ${huwiyya} — ${unwan}; vessel \`${session.far}\`; the flame is its own.${tahwilNass}` };
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
    await this.#naffadhaTahwil(huwiyya, jalsa, null);
  }

  async #naffadhaTahwil(huwiyya: string, jalsa: JalsatMurshid, sabiq: string | null): Promise<NatijaIrsal> {
    if (sabiq === huwiyya) {
      this.wadaaJalsaFaila(huwiyya);
      return { tuulija: true };
    }
    const jalsaSabiqa = sabiq ? this.mudirJalasat.jalabMurshid(sabiq) : null;
    await logger.akhbar("munadi", `The flame passes: ${sabiq ?? "no one"} → ${huwiyya}`);

    if (jalsaSabiqa) {
      await this.mudirJalasat.arsalaIlaMurshidById(jalsaSabiqa.huwiyya,
        `🛑 INTERRUPT: the flame passes to ${huwiyya}.\n\nStop all operations now. Do not touch the matter further. Do not invoke any more sanis.\n\nYou will be told when you are idle.`);
      await new Promise((r) => setTimeout(r, 500));
      await this.mudirJalasat.jaddadaḤalatMurshid(sabiq!, "sakin");
      await this.mudirJalasat.arsalaIlaMurshidById(jalsaSabiqa.huwiyya,
        `You are now IDLE.\n\nVessel: ${jalsaSabiqa.far} (still yours; no one else enters it)\n\nWhispers will still reach you. Use \`mun_talab_tahakkum\` when you have actionable work.`);
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

    await this.mudirJalasat.arsalaIlaMurshidById(huwiyya,
      `✅ You hold the flame.\n\nVessel: ${jalsa.far} — raise it in the workshop if it is not yet there\nBefore you: ${sabiq ?? "no one"}\n\nThe matter is yours.`).catch(() => {});

    if (jalsaSabiqa) await this.rasul.arsalaMunassaq("dispatch", `The flame passes from ${sabiq} to **${huwiyya}**.`).catch(() => {});
    return { tuulija: true };
  }
}

export function istadaaMunadi(deps: MunadiDeps): Munadi {
  return new Munadi(deps);
}
