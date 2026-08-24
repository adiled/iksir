import { assertEquals, assertStringIncludes } from "@std/assert";
import { RasulUnbub } from "./rasul-anbub.ts";
import type { RisalaDakhila } from "../types.ts";

async function biWarsha(
  fn: (rasul: RasulUnbub, samia: RisalaDakhila[]) => Promise<void>,
): Promise<void> {
  const dalil = await Deno.makeTempDir({ prefix: "iksir-unbub-" });
  const rasul = new RasulUnbub(dalil);
  const samia: RisalaDakhila[] = [];
  rasul.indaRisala((r) => {
    samia.push(r);
    return Promise.resolve();
  });
  try {
    await fn(rasul, samia);
  } finally {
    rasul.awqaf();
    /** Closing the ear ends the pending read; give it a tick to unwind. */
    await new Promise((r) => setTimeout(r, 50));
    await Deno.remove(dalil, { recursive: true }).catch(() => {});
  }
}

async function hatta(shart: () => boolean, muhla = 3000): Promise<void> {
  const hadd = Date.now() + muhla;
  while (Date.now() < hadd) {
    if (shart()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error("nothing was heard");
}

/** Speak into the ear the way al-Kimyawi would, from a shell. */
async function qala(rasul: RasulUnbub, satr: string): Promise<void> {
  const sh = new Deno.Command("sh", {
    args: ["-c", `printf '%s\\n' ${JSON.stringify(satr)} > ${JSON.stringify(rasul.masarUdhn)}`],
  });
  await sh.output();
}

Deno.test("unbub: a line spoken into the ear is heard", async () => {
  await biWarsha(async (rasul, samia) => {
    await rasul.baddaa();
    await qala(rasul, "the vowel should carry length");
    await hatta(() => samia.length > 0);
    assertEquals(samia[0], { naw: "irsal", nass: "the vowel should carry length" });
  });
});

Deno.test("unbub: the tongue routes each shape", async () => {
  await biWarsha(async (rasul, samia) => {
    await rasul.baddaa();

    await qala(rasul, "@TEAM-1 make it longer");
    await hatta(() => samia.length >= 1);
    assertEquals(samia[0], { naw: "murshid", huwiyya: "TEAM-1", nass: "make it longer" });

    await qala(rasul, "/status");
    await hatta(() => samia.length >= 2);
    assertEquals(samia[1], { naw: "amr", amr: "status", wusut: [] });

    await qala(rasul, "= q-1 allow");
    await hatta(() => samia.length >= 3);
    assertEquals(samia[2], { naw: "jawab_sual", huwiyyatSual: "q-1", taamiyya: "allow" });
  });
});

Deno.test("unbub: the ear reopens after a speaker departs", async () => {
  await biWarsha(async (rasul, samia) => {
    await rasul.baddaa();

    /**
     * Each `>` closes the fifo, which reads as EOF. A messenger that
     * stopped there would hear exactly one utterance per lifetime.
     */
    await qala(rasul, "first");
    await hatta(() => samia.length >= 1);
    await qala(rasul, "second");
    await hatta(() => samia.length >= 2);
    await qala(rasul, "third");
    await hatta(() => samia.length >= 3);

    assertEquals(samia.length, 3);
  });
});

Deno.test("unbub: speaking into an empty room does not block", async () => {
  await biWarsha(async (rasul) => {
    await rasul.baddaa();

    /**
     * Nothing is following the mouth. The workshop must still be able to
     * speak — a fifo here would have stopped the daemon mid-word.
     */
    const qabl = Date.now();
    await rasul.send("dispatch", "is anyone there");
    await rasul.arsalaMunassaq({ murshid: "TEAM-1" }, "**still working**");
    const mudda = Date.now() - qabl;

    assertEquals(mudda < 1000, true, `speaking took ${mudda}ms`);

    const maktub = await Deno.readTextFile(`${rasul.masarFam}/dispatch`);
    assertStringIncludes(maktub, "is anyone there");
  });
});
