/**
 * Ṣafāʾ by command — the cupel as a shell affords one
 *
 * Each maʿyār is a line the workshop can run. It leaves with nothing to say
 * and the matter stood; it leaves complaining and the matter did not.
 *
 * Whoever writes the waṣfa chooses the fire. That is the whole of the
 * arrangement: the trial is declared before the work, so nothing decided
 * afterward can move it.
 */

import type { NatijaSafa, Safa } from "../../src/hayula/safa.ts";

export class SafaAmr implements Safa {
  readonly naw = "amr";
  #warsha: string;
  #muhla: number;

  constructor(warsha = ".", muhlaMs = 120_000) {
    this.#warsha = warsha;
    this.#muhla = muhlaMs;
  }

  async assa(mayayir: string[], _ina?: string): Promise<NatijaSafa> {
    const ihtamala: string[] = [];
    const ihtaraq: Array<{ mayar: string; qawl: string }> = [];

    for (const mayar of mayayir) {
      const natija = await this.#ajri(mayar);
      if (natija.thabata) ihtamala.push(mayar);
      else ihtaraq.push({ mayar, qawl: natija.qawl });
    }

    return { thabata: ihtaraq.length === 0, ihtamala, ihtaraq };
  }

  async #ajri(mayar: string): Promise<{ thabata: boolean; qawl: string }> {
    const amr = new Deno.Command("sh", {
      args: ["-c", mayar],
      cwd: this.#warsha,
      stdout: "piped",
      stderr: "piped",
    });

    const muaqqit = AbortSignal.timeout(this.#muhla);
    try {
      const amaliyya = amr.spawn();
      const natija = await Promise.race([
        amaliyya.output(),
        new Promise<never>((_, radd) =>
          muaqqit.addEventListener("abort", () => radd(new Error("the fire burned too long")))
        ),
      ]);

      const qawl = new TextDecoder().decode(
        natija.stderr.length > 0 ? natija.stderr : natija.stdout,
      ).trim();

      return { thabata: natija.code === 0, qawl: qawl.slice(0, 2000) };
    } catch (khata) {
      return { thabata: false, qawl: String(khata) };
    }
  }
}

export function anshaaSafaAmr(warsha?: string, muhlaMs?: number): SafaAmr {
  return new SafaAmr(warsha, muhlaMs);
}
