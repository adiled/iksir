/**
 * Al-Mumayyiz (المميّز) — the cupel between the murshidūn and al-Kimyawī.
 *
 * A murshid speaks freely; mun_radd and mun_balligh are its tendrils, and
 * their grasp is the house's answer. Al-Mumayyiz serves them: for each
 * word he is grown from the murshid's own blooms — the graft on his prompt
 * — with the Taʿlīm before him and the house's reading instruments in his
 * hands, and rules in two parts. nass goes up to al-Kimyawī: the very thing
 * he asked for, or the one decision nothing else could make, with its
 * context. radd goes back to the murshid: the house's answer, or what was
 * carried up and what to do meanwhile. Nothing is censored; everything is
 * answered by someone. When the cupel is cold the word goes up as it was.
 */

import type { AlatAlIksir } from "../alat/alat-al-iksir.ts";
import type { Wasila } from "../hum/wasila.ts";
import type { Tasmim } from "../config.ts";
import type { MudirJalasat } from "./katib.ts";
import type { NtfyClient } from "../rasul/ntfy.ts";
import type { RasulKharij } from "../types.ts";
import { nazzifJson } from "../utils/strings.ts";
import { logger } from "../logging/logger.ts";

const RUQYA = "iksir-mumayyiz";
const MUHLA_MS = 150_000;
const SID_ISM = "iksir-mumayyiz";

interface MumayyizDeps {
  amil: Wasila;
  tasmim: Tasmim;
  rasul: RasulKharij;
  mudirJalasat: MudirJalasat;
  ntfy?: NtfyClient;
}

export interface Hukm {
  nass: string;
  radd: string;
}

export class Mumayyiz {
  #amil: Wasila;
  #tasmim: Tasmim;
  #rasul: RasulKharij;
  #katib: MudirJalasat;
  #ntfy?: NtfyClient;
  #sid: string | null = null;

  constructor(deps: MumayyizDeps) {
    this.#amil = deps.amil;
    this.#tasmim = deps.tasmim;
    this.#rasul = deps.rasul;
    this.#katib = deps.mudirJalasat;
    this.#ntfy = deps.ntfy;
  }

  sajjil(alat: AlatAlIksir): void {
    alat.sijill.sajjil(
      {
        name: "mun_radd",
        khass: "murshid",
        muhla: MUHLA_MS + 30_000,
        description: "Answer al-Kimyawī. Say it as you will; the house carries him what is his and answers you the rest — the grasp of this reach is that answer.",
        inputSchema: {
          type: "object",
          properties: {
            huwiyyatMurshid: { type: "string", description: "Your waṣfa's name" },
            message: { type: "string", description: "Your word, freely" },
          },
          required: ["huwiyyatMurshid", "message"],
        },
      },
      (args) => this.hukm("radd", String(args.huwiyyatMurshid), String(args.message)),
    );
    alat.sijill.sajjil(
      {
        name: "mun_balligh",
        khass: "murshid",
        muhla: MUHLA_MS + 30_000,
        description: "Tell al-Kimyawī of something unasked — a blocker, a milestone, a boundary, a decision only he can make. The house judges what reaches him and answers you the rest; the grasp of this reach is that answer.",
        inputSchema: {
          type: "object",
          properties: {
            huwiyyatMurshid: { type: "string", description: "Your waṣfa's name" },
            message: { type: "string", description: "Your word, freely" },
            awwaliyya: { type: "string", enum: ["min", "low", "default", "high", "urgent"], description: "How urgent" },
          },
          required: ["huwiyyatMurshid", "message", "awwaliyya"],
        },
      },
      (args) => this.hukm("balligh", String(args.huwiyyatMurshid), String(args.message), String(args.awwaliyya ?? "default")),
    );
  }

  async hukm(naw: "radd" | "balligh", huwiyya: string, risala: string, awwaliyya = "default"): Promise<string> {
    const jalsa = this.#katib.jalabMurshid(huwiyya);
    const graft = jalsa ? this.#amil.azhar(jalsa.id) : [];
    if (!this.#sid) {
      const majlis = await this.#amil.khalaqaJalsa(SID_ISM, "Al-Mumayyiz");
      if (majlis) this.#sid = majlis.id;
    }
    const hukm = this.#sid ? await this.#ihkum(this.#sid, naw, huwiyya, risala, graft, awwaliyya) : null;
    const nass = hukm?.nass ?? risala;
    const radd = hukm?.radd ?? "The cupel was cold; your word went to al-Kimyawī as it was.";
    if (nass) {
      await this.#rasul.arsalaMunassaq({ murshid: huwiyya }, nass);
      if (naw === "balligh" && this.#ntfy?.mumakkan()) {
        await this.#ntfy.send({ sinf: "decision", unwan: `Murshid ${huwiyya}`, matn: nass, awwaliyya: awwaliyya as never });
      }
    }
    await logger.akhbar("mumayyiz", `${huwiyya} ${naw}: ${nass ? "carried up" : "answered by the house"}`, { nass: nass.slice(0, 80) });
    return nass ? `${radd}\n\nReached al-Kimyawī:\n${nass}` : radd;
  }

  async #ihkum(sid: string, naw: string, huwiyya: string, risala: string, graft: ReturnType<Wasila["azhar"]>, awwaliyya: string): Promise<Hukm | null> {
    const kalimat = {
      talim: this.#tasmim.talim(),
      huwiyya,
      naw: naw === "radd"
        ? "This word answers a question al-Kimyawī himself asked: what he asked for goes up whole, and nothing he did not ask for rides with it."
        : `This word is unasked — a notice, urgency "${awwaliyya}". It goes up only if it is his: a blocker only he can lift, a decision only he can make, a milestone, a boundary.`,
    };
    const jawab = await this.#amil.sendPrompt(sid, risala, { agent: RUQYA, kalimat, graft, harara: 0, badhra: 7, timeoutMs: MUHLA_MS });
    if (!jawab.success || !jawab.response) {
      await logger.haDHHir("mumayyiz", `No ruling on ${huwiyya}'s word; it goes up as it was`, { error: jawab.error });
      return null;
    }
    try {
      const h = JSON.parse(nazzifJson(jawab.response)) as { nass?: unknown; radd?: unknown };
      const nass = typeof h.nass === "string" ? h.nass.trim() : risala;
      const radd = typeof h.radd === "string" && h.radd.trim() ? h.radd.trim() : (nass ? "Carried to al-Kimyawī." : "Answered by the house.");
      return { nass, radd };
    } catch (khata) {
      await logger.haDHHir("mumayyiz", `The ruling on ${huwiyya}'s word could not be read; it goes up as it was`, { error: String(khata) });
      return null;
    }
  }
}
