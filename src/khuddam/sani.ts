/**
 * Al-Ṣāniʿ (الصانع) — the Craftsman, summoned by instrument.
 *
 * A murshid does not inscribe runūz with its own hands; it calls
 * mun_istasnaa with a task, and iksir opens a bloom of its own for the
 * ṣāniʿ — on the murshid bee, with the ṣāniʿ's ruqya and no instruments —
 * then carries whatever the ṣāniʿ said last back into the murshid's vessel
 * as "Ṣāniʿ returned". The murshid is answered at once that the ṣāniʿ is
 * sent, and works on, or waits. Several may labour at once. The ṣāniʿ's
 * bloom has a trail like any other, so al-Raqīb sees it too.
 */

import type { AlatAlIksir } from "../alat/alat-al-iksir.ts";
import type { Wasila } from "../hum/wasila.ts";
import type { MudirJalasat } from "./katib.ts";
import { logger } from "../logging/logger.ts";
import { truncate } from "../utils/strings.ts";

const RUQYA = "iksir-sani";
const MUHLA_MS = 60 * 60 * 1000;

export function sajjilIstisnaa(alat: AlatAlIksir, amil: Wasila, katib: MudirJalasat): void {
  let adad = 0;
  alat.sijill.sajjil(
    {
      name: "mun_istasnaa",
      khass: "murshid",
      description:
        "Summon a ṣāniʿ to inscribe one piece of the work in your vessel. It labours in a bloom of its own; its report comes back into yours as '## Ṣāniʿ returned'. Answered at once; carry on or wait.",
      inputSchema: {
        type: "object",
        properties: {
          huwiyyatMurshid: { type: "string", description: "Your waṣfa's name" },
          task: { type: "string", description: "The waṣfa, the vessel, the runūz to inscribe and how they will be known to hold" },
        },
        required: ["huwiyyatMurshid", "task"],
      },
    },
    async (args) => {
      const huwiyya = String(args.huwiyyatMurshid);
      const task = String(args.task);
      if (!katib.jalabMurshid(huwiyya)) return `No murshid labours on ${huwiyya}; a ṣāniʿ needs a vessel to work in.`;
      const raqm = ++adad;
      const jalsa = await amil.khalaqaJalsa(huwiyya, `Ṣāniʿ ${raqm} for ${huwiyya}`);
      if (!jalsa) return "The nest would not open a bloom for the ṣāniʿ.";
      await logger.akhbar("sani", `Ṣāniʿ ${raqm} sent for ${huwiyya}`, { sid: jalsa.id });
      void amil
        .sendPrompt(jalsa.id, task, { agent: RUQYA, adawat: [], timeoutMs: MUHLA_MS })
        .then(async (jawab) => {
          const taqrir = jawab.success && jawab.response ? jawab.response : `The ṣāniʿ did not return: ${jawab.error ?? "no word"}.`;
          await katib.arsalaIlaMurshidById(huwiyya, `## Ṣāniʿ returned — ${truncate(task.split("\n")[0], 80)}\n\n${taqrir}`);
          await logger.akhbar("sani", `Ṣāniʿ ${raqm} returned to ${huwiyya}`, { najah: jawab.success });
        })
        .catch(async (khata) => {
          await logger.sajjalKhata("sani", `Ṣāniʿ ${raqm} was lost`, { error: String(khata) });
          await katib.arsalaIlaMurshidById(huwiyya, `## Ṣāniʿ returned — ${truncate(task.split("\n")[0], 80)}\n\nThe ṣāniʿ was lost: ${String(khata)}`);
        })
        .finally(() => void amil.mahaqaJalsa(jalsa.id));
      return `Ṣāniʿ ${raqm} is sent for: ${truncate(task.split("\n")[0], 80)}. You will be told when it returns; carry on with what does not wait on it.`;
    },
  );
}
