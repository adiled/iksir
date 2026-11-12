import { test, assertEquals, assertStringIncludes } from "../ikhtibar.ts";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { RasulUnbub } from "./rasul-anbub.ts";
import type { RisalaDakhila } from "../types.ts";

async function biWarsha(
  fn: (rasul: RasulUnbub, samia: RisalaDakhila[]) => Promise<void>,
): Promise<void> {
  const dalil = mkdtempSync(join(tmpdir(), "iksir-unbub-"));
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
    await new Promise((r) => setTimeout(r, 50));
    try { rmSync(dalil, { recursive: true, force: true }); } catch {  }
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

async function qala(rasul: RasulUnbub, satr: string): Promise<void> {
  execFileSync("sh", ["-c", `printf '%s\\n' ${JSON.stringify(satr)} > ${JSON.stringify(rasul.masarUdhn)}`]);
}

test("unbub: a line spoken into the ear is heard", async () => {
  await biWarsha(async (rasul, samia) => {
    await rasul.baddaa();
    await qala(rasul, "the vowel should carry length");
    await hatta(() => samia.length > 0);
    assertEquals(samia[0], { naw: "irsal", nass: "the vowel should carry length" });
  });
});

test("unbub: the tongue routes each shape", async () => {
  await biWarsha(async (rasul, samia) => {
    await rasul.baddaa();

    await qala(rasul, "@TEAM-1 make it longer");
    await hatta(() => samia.length >= 1);
    assertEquals(samia[0], { naw: "murshid", huwiyya: "TEAM-1", nass: "make it longer" });

    await qala(rasul, "what stands at the flame");
    await hatta(() => samia.length >= 2);
    assertEquals(samia[1], { naw: "irsal", nass: "what stands at the flame" });
  });
});

test("unbub: the ear reopens after a speaker departs", async () => {
  await biWarsha(async (rasul, samia) => {
    await rasul.baddaa();

    await qala(rasul, "first");
    await hatta(() => samia.length >= 1);
    await qala(rasul, "second");
    await hatta(() => samia.length >= 2);
    await qala(rasul, "third");
    await hatta(() => samia.length >= 3);

    assertEquals(samia.length, 3);
  });
});

test("unbub: speaking into an empty room does not block", async () => {
  await biWarsha(async (rasul) => {
    await rasul.baddaa();

    const qabl = Date.now();
    await rasul.send("dispatch", "is anyone there");
    await rasul.arsalaMunassaq({ murshid: "TEAM-1" }, "**still working**");
    const mudda = Date.now() - qabl;

    assertEquals(mudda < 1000, true, `speaking took ${mudda}ms`);

    const maktub = readFileSync(`${rasul.masarFam}/dispatch`, "utf-8");
    assertStringIncludes(maktub, "is anyone there");
  });
});
