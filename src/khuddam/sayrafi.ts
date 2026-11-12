/**
 * Al-Ṣayrafī (الصيرفي) — The Assayer
 *
 * The one who tests coin. A murshid declares its fire and raises its jawhar;
 * the ṣayrafī puts the matter to the fire and sets the jawhar down — with
 * iksir's own hands. It is a bee of its own, the builder and web2 at reach,
 * and keeps no memory from one duty to the next, so it cannot be talked into
 * anything. It renders no opinion. It testifies with mun_shahada, and the
 * Sijill believes only that.
 */

import type { Wasila } from "../hum/wasila.ts";
import type { Wasfa } from "../wasfa/sijill-wasfat.ts";
import type { Tasmim } from "../config.ts";
import { kalimatKhabath, thulathiMin } from "../wasfa/khabath.ts";
import { logger } from "../logging/logger.ts";

const RUQYA = "iksir-sayrafi";
const ADAWAT = ["mun_shahada"];

export class Sayrafi {
  #amil: Wasila;
  #tasmim: Tasmim;
  #jalasat = new Map<string, string>();

  constructor(amil: Wasila, tasmim: Tasmim) {
    this.#amil = amil;
    this.#tasmim = tasmim;
  }

  async assa(wasfa: Wasfa, far?: string): Promise<string> {
    const mayayir = (wasfa.mayayir ?? []).map((m) => `- \`${m}\``).join("\n");
    const buitha = await this.#bath(
      wasfa,
      "safa",
      `## Ṣafāʾ — ${wasfa.huwiyya}\n\nVessel: ${far ?? "the workshop as it stands"}\n\n` +
        `Put the matter to each maʿyār, in order, in the workshop:\n\n${mayayir}\n\n` +
        `Testify with mun_shahada, naw "safa": every maʿyār exactly as written, its exit code, and the tail of what it said.`,
    );
    return buitha
      ? `The matter of ${wasfa.huwiyya} is with the ṣayrafī. You will be told what stood.`
      : `The ṣayrafī is not nestled; the fire cannot be lit.`;
  }

  async qaddama(
    wasfa: Wasfa,
    far: string | undefined,
    jawhar: { unwan: string; matn: string; musawwada?: boolean },
  ): Promise<string> {
    const buitha = await this.#bath(
      wasfa,
      "fasl",
      `## Faṣl — ${wasfa.huwiyya}\n\nVessel: ${far ?? "the workshop as it stands"}\n\n` +
        `Set the jawhar down at the forge for examination${jawhar.musawwada ? ", as a draft" : ""}.\n\n` +
        `Title: ${jawhar.unwan}\n\nBody:\n${jawhar.matn}\n\n` +
        `Testify with mun_shahada, naw "fasl": rabit where it stands and huwiyya its name there — or khata, if it could not be set down.`,
    );
    return buitha
      ? `The jawhar of ${wasfa.huwiyya} is with the ṣayrafī to be set down. You will be told where it stands.`
      : `The ṣayrafī is not nestled; the jawhar cannot be set down.`;
  }

  async naqasha(wasfa: Wasfa, far?: string): Promise<string> {
    const buitha = await this.#bath(
      wasfa,
      "naqsh",
      `## Naqsh — ${wasfa.huwiyya}\n\nVessel: ${far ?? wasfa.huwiyya}\n\n` +
        `Al-Kimyawī has spoken: set this vessel into the codex, where it becomes canon.\n\n` +
        `Testify with mun_shahada, naw "naqsh": rabit of what entered — or khata, if the codex would not take it.`,
    );
    return buitha
      ? `${wasfa.huwiyya} goes to the ṣayrafī for naqsh.`
      : `The ṣayrafī is not nestled; nothing enters the codex.`;
  }

  async intaha(huwiyya: string): Promise<void> {
    const sid = this.#jalasat.get(huwiyya);
    if (!sid) return;
    this.#jalasat.delete(huwiyya);
    await this.#amil.mahaqaJalsa(sid);
  }

  async #bath(wasfa: Wasfa, wajib: string, nass: string): Promise<boolean> {
    await this.intaha(wasfa.huwiyya);
    const jalsa = await this.#amil.khalaqaJalsa(`iksir-sayrafi`, `Ṣayrafī ${wasfa.huwiyya}`);
    if (!jalsa) return false;
    this.#jalasat.set(wasfa.huwiyya, jalsa.id);
    const kalimat = kalimatKhabath(thulathiMin(wasfa, this.#tasmim.khabath()));
    const buitha = await this.#amil.sendPromptAsync(jalsa.id, nass, { agent: RUQYA, adawat: ADAWAT, kalimat });
    await logger.akhbar("sayrafi", `${wajib} ${wasfa.huwiyya}`, { sid: jalsa.id, buitha });
    return buitha;
  }
}
