import { assertEquals } from "@std/assert";
import { walk } from "jsr:@std/fs";
import { relative } from "jsr:@std/path";

const JIDHR = new URL("../..", import.meta.url).pathname;

/** Where Iksīr speaks kimiya and nothing else. */
const QALB = ["src/khuddam", "src/kimiya", "src/alat", "src/hum"];

/** Contrivances core may no longer name. */
const KALIMAT_NATINA = [
  "git/",
  "github/",
  "linear/",
  "natn",
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

Deno.test("hudud: Iksir names no contrivance anywhere", async () => {
  /**
   * Not core alone. The whole repository. There is no adapter left in it to
   * import, and nothing here should reach for one by path either.
   */
  const mukhalafat: string[] = [];
  for await (const entry of walk(JIDHR, { exts: [".ts"], skip: [/\.git/, /node_modules/] })) {
    if (!entry.isFile) continue;
    const nass = await Deno.readTextFile(entry.path);
    for (const satr of nass.split("\n")) {
      if (!satr.includes("from \"")) continue;
      if (/natn|hayula-git|fasl-github|safa-amr|hayula-nass/.test(satr)) {
        mukhalafat.push(`${relative(JIDHR, entry.path)}: ${satr.trim()}`);
      }
    }
  }
  assertEquals(mukhalafat, [], `Iksir reached for a contrivance:\n  ${mukhalafat.join("\n  ")}`);
});
