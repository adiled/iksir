/**
 * Rasūl Unbūb (رسول أنبوب) — The Messenger of the Pipe
 *
 * al-Kimyawī speaks into a pipe and reads from a scroll. Nothing else is
 * involved: no account, no token, no host that could one day decline to
 * carry the words.
 *
 *   uḏn  (أذن — ear)   a fifo. Write a line to it and Iksīr hears.
 *   fam  (فم — mouth)  a file. Iksīr appends; follow it and you listen.
 *
 * The ear is a pipe because a pipe blocks until something is said, which is
 * exactly the shape of listening. The mouth is a plain file because a pipe
 * with no reader would stop the workshop mid-word, and Iksīr must be able
 * to speak into an empty room.
 *
 * The tongue:
 *
 *   @TEAM-1 the vowel should carry length     to one murshid
 *   /status                                   a command
 *   > https://…/TEAM-1                        to the dispatch
 *   = <sual> <answer>                         answering a suspended sual
 *   anything else                             to the dispatch
 *
 * Qanawāt are directories under the mouth, one per murshid, so following a
 * single vessel is `tail -f fam/TEAM-1`. There is no notion of a topic to
 * create — a channel exists the moment something is said into it.
 */

import { join } from "node:path";
import {
  openSync,
  mkdirSync,
  statSync,
  appendFileSync,
  createReadStream,
} from "node:fs";
import { execFileSync } from "node:child_process";
import type { ReadStream } from "node:fs";
import { logger } from "../logging/logger.ts";
import {
  haddathaAwAdkhalaQanat,
  jalabaQanatsForSession,
  jalabJalsaByChannel,
} from "../../db/db.ts";
import type {
  KhiyarTafauli,
  QanatRisala,
  Rasul,
  RisalaDakhila,
} from "../types.ts";

const MUQADDIM = "unbub";

function dalilRasul(): string {
  const hala = process.env.IKSIR_STATE_DIR ??
    join(
      process.env.XDG_DATA_HOME ??
        join(process.env.HOME ?? ".", ".local", "share"),
      "iksir",
    );
  return join(hala, "rasul");
}

export class RasulUnbub implements Rasul {
  #dalil: string;
  #mualij: ((risala: RisalaDakhila) => Promise<void>) | null = null;
  #yastami = false;
  #milaf: ReadStream | null = null;
  #qanawat = new Map<string, string>();

  constructor(dalil?: string) {
    this.#dalil = dalil ?? dalilRasul();
  }

  mumakkan(): boolean {
    return true;
  }

  get masarUdhn(): string {
    return join(this.#dalil, "udhn");
  }

  get masarFam(): string {
    return join(this.#dalil, "fam");
  }

  #masarQanat(qanat: QanatRisala): string {
    if (typeof qanat === "object") return join(this.masarFam, qanat.murshid);
    return join(this.masarFam, qanat);
  }

  async #udhnMawjuda(): Promise<void> {
    mkdirSync(this.#dalil, { recursive: true });
    mkdirSync(this.masarFam, { recursive: true });
    try {
      statSync(this.masarUdhn);
    } catch {
      try {
        execFileSync("mkfifo", [this.masarUdhn]);
      } catch {
        throw new Error(`could not open an ear at ${this.masarUdhn}`);
      }
    }
  }

  // ── Speaking ──────────────────────────────────────────────────────

  async send(qanat: QanatRisala, nass: string): Promise<void> {
    const masar = this.#masarQanat(qanat);
    const waqt = new Date().toISOString();
    appendFileSync(masar, `\n[${waqt}]\n${nass}\n`);
  }

  arsalaMunassaq(qanat: QanatRisala, nass: string): Promise<void> {
    // The scroll is already plain. Markdown is left as written — a reader
    // who wants it rendered has better tools than Iksīr.
    return this.send(qanat, nass);
  }

  async arsalaSualBiKhiyarat(
    qanat: QanatRisala,
    nass: string,
    khiyarat: KhiyarTafauli[],
  ): Promise<number | null> {
    const masrud = khiyarat.map((k) => `  = ${k.miftah}   ${k.nass}`).join("\n");
    await this.send(qanat, `${nass}\n\n${masrud}\n\nAnswer with:  = <key>`);
    return null;
  }

  // ── Qanawāt ───────────────────────────────────────────────────────

  async khalaqaQanatMurshid(huwiyya: string, unwan: string): Promise<string | null> {
    const masar = join(this.masarFam, huwiyya);
    appendFileSync(masar, `# ${huwiyya} — ${unwan}\n`);
    this.#qanawat.set(huwiyya, huwiyya);
    haddathaAwAdkhalaQanat(huwiyya, MUQADDIM, huwiyya);
    return huwiyya;
  }

  yamlikQanatMurshid(huwiyya: string): boolean {
    if (this.#qanawat.has(huwiyya)) return true;
    return MUQADDIM in jalabaQanatsForSession(huwiyya);
  }

  hammalQanawatLilJalsa(huwiyya: string): Record<string, string> {
    const qanawat = jalabaQanatsForSession(huwiyya);
    const li = qanawat[MUQADDIM];
    if (li) this.#qanawat.set(huwiyya, li);
    return qanawat;
  }

  hallJalsaBilQanat(muqaddim: string, huwiyatQanat: string): string | null {
    if (muqaddim !== MUQADDIM) return null;
    return jalabJalsaByChannel(muqaddim, huwiyatQanat);
  }

  // ── Listening ─────────────────────────────────────────────────────

  indaRisala(mualij: (risala: RisalaDakhila) => Promise<void>): void {
    this.#mualij = mualij;
  }

  /** One line from the ear becomes one utterance. */
  async #hallSatr(satr: string): Promise<void> {
    const nass = satr.trim();
    if (!nass || !this.#mualij) return;

    if (nass.startsWith("@")) {
      const [huwiyya, ...baqi] = nass.slice(1).split(/\s+/);
      const qawl = baqi.join(" ");
      if (huwiyya && qawl) {
        await this.#mualij({ naw: "murshid", huwiyya, nass: qawl });
      }
      return;
    }

    if (nass.startsWith("/")) {
      const [amr, ...wusut] = nass.slice(1).split(/\s+/);
      await this.#mualij({ naw: "amr", amr: amr.toLowerCase(), wusut });
      return;
    }

    if (nass.startsWith("=")) {
      const [huwiyyatSual, ...taamiyya] = nass.slice(1).trim().split(/\s+/);
      if (huwiyyatSual) {
        await this.#mualij({
          naw: "jawab_sual",
          huwiyyatSual,
          taamiyya: taamiyya.join(" ") || huwiyyatSual,
        });
      }
      return;
    }

    const qawl = nass.startsWith(">") ? nass.slice(1).trim() : nass;
    await this.#mualij({ naw: "irsal", nass: qawl });
  }

  /**
   * The ear is held open for both reading and writing at once.
   *
   * A fifo opened only to read blocks until someone speaks — and it blocks
   * the whole workshop, not just the listener, so Iksīr could not even
   * start the process that was going to speak to it. Holding it open both
   * ways never blocks, and because Iksīr is itself a writer the ear never
   * falls to EOF when a speaker departs.
   */
  async baddaa(): Promise<void> {
    await this.#udhnMawjuda();
    this.#yastami = true;

    await logger.akhbar("rasul", "Listening at the pipe", {
      udhn: this.masarUdhn,
      fam: this.masarFam,
    });

    const fd = openSync(this.masarUdhn, "r+");
    const qari = createReadStream("", { fd, autoClose: true });
    this.#milaf = qari;

    (async () => {
      const muhallil = new TextDecoder();
      let dhakira = "";
      try {
        for await (const qitaa of qari) {
          if (!this.#yastami) break;
          dhakira += muhallil.decode(qitaa as Buffer, { stream: true });
          let nl: number;
          while ((nl = dhakira.indexOf("\n")) >= 0) {
            const satr = dhakira.slice(0, nl);
            dhakira = dhakira.slice(nl + 1);
            await this.#hallSatr(satr).catch(async (e) =>
              await logger.sajjalKhata("rasul", "Utterance failed", { error: String(e) })
            );
          }
        }
      } catch {
        // The ear was shut under us. Nothing more will be heard.
      } finally {
        try {
          qari.destroy();
        } catch {
          // Already shut.
        }
        this.#milaf = null;
      }
    })();
  }

  /**
   * A read already waiting on the ear will not end merely because the ear
   * is shut. So Iksīr speaks one empty word into its own ear: the listener
   * wakes, finds that listening is over, and lets go.
   */
  awqaf(): void {
    if (!this.#yastami) return;
    this.#yastami = false;
    try {
      appendFileSync(this.masarUdhn, "\n");
    } catch {
      // The ear is already gone; the listener will unwind on its own.
    }
    try {
      this.#milaf?.destroy();
    } catch {
      // Already shut.
    }
    this.#milaf = null;
  }

  tahaqqaq(): Promise<boolean> {
    return Promise.resolve(true);
  }
}

export function anshaaRasulUnbub(dalil?: string): RasulUnbub {
  return new RasulUnbub(dalil);
}
