/**
 * Hayat (حياة) — The Life Force
 *
 * One of the sacred Khuddām (خدّام) of Iksīr.
 *
 * While others sleep, Hayat breathes. The slow pulse — listening at each
 * decanted jawhar for what has been said of it, and carrying those words
 * to the murshid that made it.
 *
 * In the quiet hours, when al-Kimyawi rests, Hayat performs the sacred
 * rites of seyana — drawing the codex in beneath each murshid's vessel,
 * so nothing stands on ground that has moved.
 *
 * Hayat does not think. Hayat does not decide. Hayat watches,
 * breathes, and keeps the flame from going cold.
 */

import type { Fasl } from "../hayula/fasl.ts";
import { mayyazaTaaliq } from "./mumayyiz.ts";
import type { SijillWasfat } from "../wasfa/sijill-wasfat.ts";
import { logger } from "../logging/logger.ts";
import { fiNitaqAlWaqt, minutesUntil, todayInTz } from "../utils/time.ts";
import type { Hayula } from "../hayula/hayula.ts";
import type {
  TasmimIksir,
  TaaliqMuraja,
  JalsatMurshid,
} from "../types.ts";
import type { MudirJalasat } from "./katib.ts";

export interface NatijaSeyana {
  far: string;
  huwiyya: string;
  najah: boolean;
  fil: "udmija" | "muhaddath" | "taarudat" | "khata";
  taarudat?: string[];
  iltizamatKhalfa?: number;
  nass: string;
}

interface IstijabatHayat {
  indaAmrAlKimyawi: (
    session: JalsatMurshid,
    huwiyyatWasfa: string,
    comment: TaaliqMuraja
  ) => Promise<void>;

  indaTaaliqatJadida: (
    session: JalsatMurshid,
    huwiyyatWasfa: string,
    comments: TaaliqMuraja[]
  ) => Promise<void>;

  utlubWadaSeyana: () => Promise<boolean>;

  harrarWadaSeyana: () => Promise<void>;

  indaIktimalSeyana: (results: NatijaSeyana[]) => Promise<void>;
}

interface MutatallabatHayat {
  tasmim: TasmimIksir;
  mudirJalasat: MudirJalasat;
  fasl: Fasl;
  hayula: Hayula;
  wasfat: SijillWasfat;
}

export class DawratHayat {
  #tasmim: TasmimIksir;
  #mudirJalasat: MudirJalasat;
  #fasl: Fasl;
  #hayula: Hayula;
  #istijabat: IstijabatHayat;
  #tarikhAkhirSeyana: string | null = null;
  #seyanaJariya = false;
  #wasfat: SijillWasfat;
  #akhirIstimaa: Map<string, string> = new Map();

  constructor(deps: MutatallabatHayat, callbacks: IstijabatHayat) {
    this.#tasmim = deps.tasmim;
    this.#mudirJalasat = deps.mudirJalasat;
    this.#fasl = deps.fasl;
    this.#hayula = deps.hayula;
    this.#wasfat = deps.wasfat;
    this.#istijabat = callbacks;
  }

  async dawra(): Promise<void> {
    const mafsula = await this.#wasfat.bihala("mafsul", 50);

    if (mafsula.length > 0) {
      await logger.tatbeeq("hayat", `Watching ${mafsula.length} decanted jawhar`);
      for (const wasfa of mafsula) {
        await this.raqabJawhar(wasfa.huwiyya);
      }
    }

    if (this.fiSaatHudu()) {
      await this.naffadhSeyana();
    }

    await logger.tatbeeq("hayat", "Breath complete");
  }

  async raqabJawhar(huwiyya: string): Promise<void> {
    const session = this.#mudirJalasat.jalabMurshid(huwiyya);
    if (!session) return;

    const mundhu = this.#akhirIstimaa.get(huwiyya);
    const waridat = await this.#fasl.taaliqat(huwiyya, mundhu);
    this.#akhirIstimaa.set(huwiyya, new Date().toISOString());

    if (waridat.length === 0) return;

    const ismKimyawi = this.#tasmim.kimyawi.ism;
    const awamir: TaaliqMuraja[] = [];
    const ukhra: TaaliqMuraja[] = [];

    for (const warid of waridat) {
      const minhu = warid.qail === ismKimyawi;
      const taaliq: TaaliqMuraja = {
        id: warid.huwiyya,
        huwiyyatWasfa: huwiyya,
        author: warid.qail,
        body: warid.nass,
        path: warid.mawdi?.split(":")[0],
        line: warid.mawdi?.includes(":") ? Number(warid.mawdi.split(":")[1]) : undefined,
        createdAt: new Date(warid.qila_fi),
        isAlKimyawi: minhu,
        assessment: mayyazaTaaliq(warid.nass, minhu),
      };
      if (minhu && taaliq.assessment.isCommand) awamir.push(taaliq);
      else if (!minhu) ukhra.push(taaliq);
    }

    for (const amr of awamir) {
      await logger.akhbar("hayat", `amr al-Kimyawi upon ${huwiyya}`, {
        body: amr.body.slice(0, 100),
      });
      await this.#istijabat.indaAmrAlKimyawi(session, huwiyya, amr);
    }

    if (ukhra.length > 0) {
      await this.#istijabat.indaTaaliqatJadida(session, huwiyya, ukhra);
    }
  }

  fiSaatHudu(): boolean {
    if (!this.#tasmim.saatSukun.mufattah) return false;
    const { mintaqaZamaniyya, bidaya, nihaya } = this.#tasmim.saatSukun;
    return fiNitaqAlWaqt(mintaqaZamaniyya, bidaya, nihaya);
  }

  fiAkhirSaatHudu(): boolean {
    if (!this.fiSaatHudu()) return false;
    const { mintaqaZamaniyya, nihaya, daqaiqNafizhaSeyana } = this.#tasmim.saatSukun;
    const remaining = minutesUntil(mintaqaZamaniyya, nihaya);
    return remaining <= daqaiqNafizhaSeyana && remaining > 0;
  }

  async naffadhSeyana(): Promise<void> {
    if (!this.fiAkhirSaatHudu()) {
      return;
    }

    const today = todayInTz(this.#tasmim.saatSukun.mintaqaZamaniyya);
    if (this.#tarikhAkhirSeyana === today) {
      return;
    }

    if (this.#seyanaJariya) {
      return;
    }

    await logger.akhbar("keepalive", "Starting overnight maintenance");
    this.#seyanaJariya = true;

    const granted = await this.#istijabat.utlubWadaSeyana();
    if (!granted) {
      await logger.haDHHir("keepalive", "Maintenance mode denied - murshid active");
      this.#seyanaJariya = false;
      return;
    }

    this.#mudirJalasat.wadaaQuflGit(true);

    try {
      const results: NatijaSeyana[] = [];
      const sessions = this.#mudirJalasat.wajadaJalasatMurshid();

      const originalBranch = await this.#hayula.waqif();

      for (const session of sessions) {
        const result = await this.sayanFar(session);
        results.push(result);
      }

      if (originalBranch) {
        const istarjaad = await this.#hayula.dakhala(originalBranch);
        if (!istarjaad) {
          await logger.sajjalKhata("keepalive", `Failed to istarjaa branch ${originalBranch}, falling back to main`);
          await this.#hayula.dakhala(await this.#hayula.asas());
        }
      }

      await this.#istijabat.indaIktimalSeyana(results);

      this.#tarikhAkhirSeyana = today;
      await logger.akhbar("keepalive", "Overnight maintenance complete", {
        branches: results.length,
        merged: results.filter(r => r.fil === "udmija").length,
        conflicts: results.filter(r => r.fil === "taarudat").length,
      });
    } catch (error) {
      await logger.sajjalKhata("keepalive", "Maintenance failed", { error: String(error) });
    } finally {
      this.#mudirJalasat.wadaaQuflGit(false);
      await this.#istijabat.harrarWadaSeyana();
      this.#seyanaJariya = false;
    }
  }

  async sayanFar(session: JalsatMurshid): Promise<NatijaSeyana> {
    const far = session.far;
    const huwiyya = session.huwiyya;

    await logger.akhbar("keepalive", `Maintaining branch ${far}`);

    try {
      const checkedOut = await this.#hayula.dakhala(far);
      if (!checkedOut) {
        return {
          far,
          huwiyya,
          najah: false,
          fil: "khata",
          nass: `Failed to intaqalaIla ${far}`,
        };
      }

      const behind = await this.#hayula.masafa(far);
      if (behind === 0) {
        return {
          far,
          huwiyya,
          najah: true,
          fil: "muhaddath",
          iltizamatKhalfa: 0,
          nass: "Already up to date with main",
        };
      }

      const mergeResult = await this.#hayula.sahaba();

      if (mergeResult.najah) {
        await this.#hayula.azhara?.(far);

        return {
          far,
          huwiyya,
          najah: true,
          fil: "udmija",
          iltizamatKhalfa: behind,
          nass: `Drew in ${behind} change(s) from the codex`,
        };
      }

      return {
        far,
        huwiyya,
        najah: false,
        fil: "taarudat",
        taarudat: mergeResult.taarudat,
        iltizamatKhalfa: behind,
        nass: mergeResult.khata ?? "the codex would not settle beneath this vessel",
      };
    } catch (error) {
      return {
        far,
        huwiyya,
        najah: false,
        fil: "khata",
        nass: String(error),
      };
    }
  }
}

export function awqadaHayat(
  deps: MutatallabatHayat,
  callbacks: IstijabatHayat
): DawratHayat {
  return new DawratHayat(deps, callbacks);
}
