/**
 * Hayūlā Naṣṣ — matter that is text
 *
 * A workshop is a directory. The codex is one file in it. A vessel is a
 * copy of that file, kept aside, worked on alone.
 *
 * Matter here is a **faṣl** of the text — a heading and everything under it
 * until the next heading of its rank. That is what istiḥāla draws across:
 * not lines, which are an accident of where the text happens to wrap, but
 * the passages a reader would name.
 *
 *   codex.md            the codex
 *   .awani/<inaʾ>.md    a vessel
 *   .awani/<inaʾ>.asas  the codex as it stood when the vessel was raised
 *   .awani/<inaʾ>.jamd  what was frozen, and why
 *
 * No history is kept beyond the last freezing. A hayūlā may remember more,
 * and one made of git does; this one is as simple as matter gets.
 */

import { basename, join } from "jsr:@std/path";
import type { Hayula, NatijaIstihala, NatijaSahb } from "../../src/hayula/hayula.ts";

const DALIL_AWANI = ".awani";

/** Split text into its fusul — heading, and all that belongs to it. */
export function fusul(nass: string): Map<string, string> {
  const natija = new Map<string, string>();
  const asatir = nass.split("\n");
  let unwan = "";
  let jism: string[] = [];

  const iqfal = () => {
    if (unwan) natija.set(unwan, jism.join("\n").trimEnd());
  };

  for (const satr of asatir) {
    const raas = satr.match(/^(#{1,6})\s+(.*)$/);
    if (raas) {
      iqfal();
      unwan = raas[2].trim();
      jism = [satr];
    } else if (unwan) {
      jism.push(satr);
    }
  }
  iqfal();
  return natija;
}

export class HayulaNass implements Hayula {
  readonly naw = "nass";
  #warsha: string;
  #ismCodex: string;
  #waqif: string;

  constructor(masarCodex: string) {
    this.#warsha = masarCodex.slice(0, masarCodex.lastIndexOf("/")) || ".";
    this.#ismCodex = basename(masarCodex);
    this.#waqif = "codex";
  }

  get masarCodex(): string {
    return join(this.#warsha, this.#ismCodex);
  }

  #masarIna(ina: string): string {
    return join(this.#warsha, DALIL_AWANI, `${ina}.md`);
  }

  #masarAsas(ina: string): string {
    return join(this.#warsha, DALIL_AWANI, `${ina}.asas`);
  }

  #masarJamd(ina: string): string {
    return join(this.#warsha, DALIL_AWANI, `${ina}.jamd`);
  }

  /** The file the current vessel lives in — the codex itself when in it. */
  #masarHali(): string {
    return this.#waqif === "codex" ? this.masarCodex : this.#masarIna(this.#waqif);
  }

  async #iqra(masar: string): Promise<string> {
    try {
      return await Deno.readTextFile(masar);
    } catch {
      return "";
    }
  }

  async dakhala(ina: string, _asas?: string): Promise<boolean> {
    if (ina === "codex" || ina === this.#ismCodex) {
      this.#waqif = "codex";
      return true;
    }

    await Deno.mkdir(join(this.#warsha, DALIL_AWANI), { recursive: true });
    const masar = this.#masarIna(ina);

    try {
      await Deno.stat(masar);
    } catch {
      // Raising a vessel: it begins as the codex stands, and remembers how
      // the codex stood, so drift can be told later.
      const codex = await this.#iqra(this.masarCodex);
      await Deno.writeTextFile(masar, codex);
      await Deno.writeTextFile(this.#masarAsas(ina), codex);
      await Deno.writeTextFile(this.#masarJamd(ina), codex);
    }

    this.#waqif = ina;
    return true;
  }

  waqif(): Promise<string | null> {
    return Promise.resolve(this.#waqif);
  }

  asas(): Promise<string> {
    return Promise.resolve("codex");
  }

  async mudtarib(): Promise<boolean> {
    if (this.#waqif === "codex") return false;
    const alan = await this.#iqra(this.#masarHali());
    const jamd = await this.#iqra(this.#masarJamd(this.#waqif));
    return alan !== jamd;
  }

  async jammada(sabab: string): Promise<boolean> {
    if (this.#waqif === "codex") return false;
    const alan = await this.#iqra(this.#masarHali());
    await Deno.writeTextFile(this.#masarJamd(this.#waqif), alan);
    void sabab;
    return true;
  }

  async thabbata(sabab: string, _mawad?: string[]): Promise<boolean> {
    if (this.#waqif === "codex") return false;
    const alan = await this.#iqra(this.#masarHali());
    const jamd = await this.#iqra(this.#masarJamd(this.#waqif));
    if (alan === jamd) return false;
    await Deno.writeTextFile(this.#masarJamd(this.#waqif), alan);
    void sabab;
    return true;
  }

  /**
   * Draw the codex in beneath a vessel.
   *
   * A faṣl the vessel never touched takes whatever the codex now says. A
   * faṣl both have altered since the vessel was raised is a taʿāruḍ, and
   * belongs to al-Kimyawī, not to a merge rule.
   */
  async sahaba(ina?: string): Promise<NatijaSahb> {
    const hadaf = ina ?? this.#waqif;
    if (hadaf === "codex") return { najah: true };

    const codex = fusul(await this.#iqra(this.masarCodex));
    const asasQadim = fusul(await this.#iqra(this.#masarAsas(hadaf)));
    const nassIna = await this.#iqra(this.#masarIna(hadaf));
    const fiIna = fusul(nassIna);

    const taarudat: string[] = [];
    const majmu = new Map(fiIna);

    for (const [unwan, jism] of codex) {
      const qadim = asasQadim.get(unwan);
      const ladayna = fiIna.get(unwan);

      if (ladayna === undefined) {
        majmu.set(unwan, jism);
        continue;
      }
      if (jism === qadim) continue;
      if (ladayna === qadim) {
        majmu.set(unwan, jism);
        continue;
      }
      if (ladayna !== jism) taarudat.push(unwan);
    }

    if (taarudat.length > 0) {
      return { najah: false, taarudat, khata: `${taarudat.length} fasl in contention` };
    }

    await Deno.writeTextFile(this.#masarIna(hadaf), [...majmu.values()].join("\n\n") + "\n");
    await Deno.writeTextFile(this.#masarAsas(hadaf), await this.#iqra(this.masarCodex));
    return { najah: true };
  }

  async masafa(ina: string): Promise<number> {
    const codex = fusul(await this.#iqra(this.masarCodex));
    const asasQadim = fusul(await this.#iqra(this.#masarAsas(ina)));
    let adad = 0;
    for (const [unwan, jism] of codex) {
      if (asasQadim.get(unwan) !== jism) adad++;
    }
    return adad;
  }

  /**
   * Draw chosen fusul out of a vessel and set them on a fresh one raised
   * from the codex. What is not named does not travel.
   */
  async istahala(jawhar: string, ahjar: string[], asas?: string): Promise<NatijaIstihala> {
    const buwtaqa = this.#waqif;
    if (buwtaqa === "codex") {
      return { najah: false, nawKhata: "dukhul", khata: "nothing is drawn from the codex itself" };
    }

    const minAyn = fusul(await this.#iqra(this.#masarIna(buwtaqa)));
    const qaida = asas && asas !== "codex"
      ? fusul(await this.#iqra(this.#masarIna(asas)))
      : fusul(await this.#iqra(this.masarCodex));

    const ghaib = ahjar.filter((h) => !minAyn.has(h));
    if (ghaib.length > 0) {
      return {
        najah: false,
        nawKhata: "istirjaa",
        khata: `no such fasl in ${buwtaqa}: ${ghaib.join(", ")}`,
      };
    }

    const majmu = new Map(qaida);
    for (const hajar of ahjar) majmu.set(hajar, minAyn.get(hajar)!);

    await Deno.mkdir(join(this.#warsha, DALIL_AWANI), { recursive: true });
    const nass = [...majmu.values()].join("\n\n") + "\n";
    await Deno.writeTextFile(this.#masarIna(jawhar), nass);
    await Deno.writeTextFile(this.#masarAsas(jawhar), await this.#iqra(this.masarCodex));
    await Deno.writeTextFile(this.#masarJamd(jawhar), nass);

    return {
      najah: true,
      buwtaqa,
      jawhar,
      asas: asas ?? "codex",
      adadAhjar: ahjar.length,
    };
  }

  /** Inscribe a vessel into the codex. */
  async naqasha(ina: string): Promise<boolean> {
    const nass = await this.#iqra(this.#masarIna(ina));
    if (!nass) return false;
    await Deno.writeTextFile(this.masarCodex, nass);
    return true;
  }
}

export function anshaaHayulaNass(masarCodex: string): HayulaNass {
  return new HayulaNass(masarCodex);
}
