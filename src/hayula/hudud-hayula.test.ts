import { test, assertEquals } from "../ikhtibar.ts";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

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

function jamaaMilafat(dalil: string): string[] {
  const milafat: string[] = [];
  let madkhulat: string[];
  try {
    madkhulat = readdirSync(dalil, { withFileTypes: true }).map((e) => e.name);
  } catch {
    return milafat;
  }
  for (const ism of madkhulat) {
    const masar = join(dalil, ism);
    let huwaDalil = false;
    try {
      huwaDalil = statSync(masar).isDirectory();
    } catch {
      continue;
    }
    if (huwaDalil) {
      milafat.push(...jamaaMilafat(masar));
    } else if (ism.endsWith(".ts") && !ism.endsWith(".test.ts")) {
      milafat.push(masar);
    }
  }
  return milafat;
}

async function milafatQalb(): Promise<string[]> {
  const milafat: string[] = [];
  for (const dalil of QALB) {
    milafat.push(...jamaaMilafat(`${JIDHR}${dalil}`));
  }
  return milafat;
}

test("hudud: core names nothing of the natn", async () => {
  const mukhalafat: string[] = [];

  for (const masar of await milafatQalb()) {
    const nass = readFileSync(masar, "utf-8");
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

test("hudud: Iksir names no contrivance anywhere", async () => {
  /**
   * Not core alone. The whole repository. There is no adapter left in it to
   * import, and nothing here should reach for one by path either.
   */
  const mukhalafat: string[] = [];
  for (const masar of jamaaMilafat(JIDHR).filter((m) => !m.includes(".git") && !m.includes("node_modules"))) {
    const entry = { path: masar };
    const nass = readFileSync(entry.path, "utf-8");
    for (const satr of nass.split("\n")) {
      if (!satr.includes("from \"")) continue;
      if (/natn|hayula-git|fasl-github|safa-amr|hayula-nass/.test(satr)) {
        mukhalafat.push(`${relative(JIDHR, entry.path)}: ${satr.trim()}`);
      }
    }
  }
  assertEquals(mukhalafat, [], `Iksir reached for a contrivance:\n  ${mukhalafat.join("\n  ")}`);
});
