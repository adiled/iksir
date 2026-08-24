import { assert, assertEquals } from "@std/assert";
import { walk } from "jsr:@std/fs";
import { relative } from "jsr:@std/path";

const JIDHR = new URL("../..", import.meta.url).pathname;

/** Where Iksīr speaks kimiya and nothing else. */
const QALB = ["src/daemon", "src/kimiya", "src/alat", "src/hum"];

/** Contrivances core may no longer name. */
const KALIMAT_NATINA = [
  "git/operations.ts",
  "github/gh.ts",
  "linear/client.ts",
  "natn/",
];

async function milafatQalb(): Promise<string[]> {
  const milafat: string[] = [];
  for (const dalil of QALB) {
    try {
      for await (const entry of walk(`${JIDHR}${dalil}`, { exts: [".ts"] })) {
        if (entry.isFile && !entry.path.endsWith(".test.ts")) milafat.push(entry.path);
      }
    } catch {
      // A core directory that does not exist yet is not a violation.
    }
  }
  return milafat;
}

Deno.test("hudud: core names nothing of the natn", async () => {
  const mukhalafat: string[] = [];

  for (const masar of await milafatQalb()) {
    const nass = await Deno.readTextFile(masar);
    for (const satr of nass.split("\n")) {
      if (!satr.includes("import") && !satr.includes("from \"")) continue;
      for (const kalima of KALIMAT_NATINA) {
        if (satr.includes(kalima)) {
          mukhalafat.push(`${relative(JIDHR, masar)}: ${satr.trim()}`);
        }
      }
    }
  }

  assertEquals(
    mukhalafat,
    [],
    `The natn got in. Core speaks kimiya; these reach for a contrivance:\n  ${
      mukhalafat.join("\n  ")
    }`,
  );
});

Deno.test("hudud: the natn reaches up only for shapes", async () => {
  /**
   * An adapter may know Iksīr's interfaces — that is what it conforms to.
   * It may not know Iksīr's organs. Reaching into a daemon would tie this
   * directory to a process it is meant to be able to leave.
   */
  const mukhalafat: string[] = [];
  for await (const entry of walk(`${JIDHR}natn`, { exts: [".ts"] })) {
    if (!entry.isFile) continue;
    const nass = await Deno.readTextFile(entry.path);
    for (const satr of nass.split("\n")) {
      if (!satr.includes("from \"")) continue;
      if (satr.includes("src/daemon") || satr.includes("src/alat")) {
        mukhalafat.push(`${relative(JIDHR, entry.path)}: ${satr.trim()}`);
      }
    }
  }
  assertEquals(mukhalafat, [], `An adapter reached into Iksīr's organs:\n  ${mukhalafat.join("\n  ")}`);
});

Deno.test("hudud: the github adapter satisfies the fasl in full", async () => {
  const { FaslGitHub } = await import("../../natn/fasl-github/mod.ts");
  const fasl = new FaslGitHub(null as never);

  for (const amal of ["qaddama", "hala", "taaliqat", "thabit", "farq"]) {
    assert(
      typeof (fasl as unknown as Record<string, unknown>)[amal] === "function",
      `${amal} is named in the fasl but the github adapter cannot do it`,
    );
  }
  assertEquals(fasl.naw, "github");
});

Deno.test("hudud: the git adapter satisfies the hayula in full", async () => {
  const { HayulaGit } = await import("../../natn/hayula-git/mod.ts");
  const hayula = new HayulaGit();

  /**
   * Every operation the constitution names must be answerable. A missing
   * one would surface as a runtime absence deep inside a transmutation.
   */
  for (const amal of ["dakhala", "waqif", "asas", "mudtarib", "jammada", "thabbata", "sahaba", "masafa"]) {
    assert(
      typeof (hayula as unknown as Record<string, unknown>)[amal] === "function",
      `${amal} is named in the hayula but the git adapter cannot do it`,
    );
  }

  assertEquals(hayula.naw, "git");
  /** azhara is optional by nature — git has an outside, so it must have one. */
  assert(typeof hayula.azhara === "function", "git has a beyond; azhara must exist");
});
