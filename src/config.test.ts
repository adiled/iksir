import { test, assertEquals } from "./ikhtibar.ts";
import { tmpdir } from "node:os";
import { mkdtempSync, writeFileSync, rmSync, statSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { Tasmim, qimaMinKalima, tahaqqaq } from "./config.ts";

function fiDar(fn: (dir: string, tasmim: Tasmim) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "iksir-config-test-"));
  try {
    fn(dir, new Tasmim(dir));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function baadHin(dir: string, ism: string, nass: string): void {
  writeFileSync(join(dir, ism), nass);
  const { mtimeMs } = statSync(join(dir, ism));
  const baad = Math.max(Date.now(), mtimeMs) + 1500;
  utimesSync(join(dir, ism), baad / 1000, baad / 1000);
}

test("tasmim: defaults when nothing is written", () => {
  fiDar((_, tasmim) => {
    assertEquals(tasmim.mawjud(), false);
    assertEquals(tasmim.khabath(), { majlis: [], kur: [], sijillat: [] });
    assertEquals(tasmim.namudhaj(), undefined);
    assertEquals(tasmim.sirr("telegram.ramz"), undefined);
    assertEquals(tasmim.ntfy(), null);
  });
});

test("tasmim: the roster, the particulars and the model are read", () => {
  fiDar((dir, tasmim) => {
    writeFileSync(join(dir, "iksir.json"), JSON.stringify({
      khabath: { majlis: ["telegram"], kur: "github,gitlab", sijillat: ["github", "linear"], telegram: { muhadatha: "1", mawduuIrsal: 5 } },
      hum: { namudhaj: "claude-opus-5-5" },
      wasfat: { sabiqa: "LUGHA" },
      ahdaq: { mustawa: "debug" },
    }));
    assertEquals(tasmim.khabath().kur, ["github", "gitlab"]);
    assertEquals(tasmim.khabath().sijillat, ["github", "linear"]);
    assertEquals(tasmim.khabath().telegram?.mawduuIrsal, 5);
    assertEquals(tasmim.namudhaj(), "claude-opus-5-5");
    assertEquals(tasmim.now().wasfat.sabiqa, "LUGHA");
    assertEquals(tasmim.mustawaAhdaq(), "debug");
    assertEquals(tahaqqaq(tasmim.now()), []);
  });
});

test("tasmim: a change on disk is a change in the daemon, no restart", () => {
  fiDar((dir, tasmim) => {
    writeFileSync(join(dir, "iksir.json"), JSON.stringify({ hum: { namudhaj: "one" } }));
    assertEquals(tasmim.namudhaj(), "one");
    baadHin(dir, "iksir.json", JSON.stringify({ hum: { namudhaj: "two" } }));
    assertEquals(tasmim.namudhaj(), "two");
  });
});

test("tasmim: secrets live apart, 0600, and are read live", () => {
  fiDar((dir, tasmim) => {
    tasmim.dhabbitSirr("telegram.ramz", "123:abc");
    assertEquals(statSync(join(dir, "asrar")).mode & 0o777, 0o600);
    assertEquals(tasmim.sirr("telegram.ramz"), "123:abc");
    assertEquals(tasmim.asmaAsrar(), ["telegram.ramz"]);
    assertEquals(tasmim.mawjud(), false);
    baadHin(dir, "asrar", "telegram.ramz=456:def\n");
    assertEquals(tasmim.sirr("telegram.ramz"), "456:def");
    tasmim.dhabbitSirr("telegram.ramz", undefined);
    assertEquals(tasmim.sirr("telegram.ramz"), undefined);
  });
});

test("tasmim: set and unset by dotted path, leaving the rest standing", () => {
  fiDar((dir, tasmim) => {
    writeFileSync(join(dir, "iksir.json"), JSON.stringify({ hum: { namudhaj: "one" }, khabath: { telegram: { muhadatha: "1" } } }));
    tasmim.dhabbit("khabath.kur", ["github"]);
    tasmim.dhabbit("khabath.telegram.mawduuIrsal", 7);
    assertEquals(tasmim.iqraMasar("khabath.kur"), ["github"]);
    assertEquals(tasmim.iqraMasar("khabath.telegram"), { muhadatha: "1", mawduuIrsal: 7 });
    assertEquals(tasmim.namudhaj(), "one");
    tasmim.dhabbit("hum.namudhaj", undefined);
    assertEquals(tasmim.namudhaj(), undefined);
  });
});

test("tasmim: a word from the command line becomes JSON when it can, a list at commas, else itself", () => {
  assertEquals(qimaMinKalima('["github","gitlab"]'), ["github", "gitlab"]);
  assertEquals(qimaMinKalima("github,gitlab"), ["github", "gitlab"]);
  assertEquals(qimaMinKalima("5"), 5);
  assertEquals(qimaMinKalima("true"), true);
  assertEquals(qimaMinKalima("claude-opus-5-5"), "claude-opus-5-5");
});

test("tasmim: complaints name what iksir cannot honour", () => {
  fiDar((dir, tasmim) => {
    writeFileSync(join(dir, "iksir.json"), JSON.stringify({ khabath: { majlis: ["telegram", "slack"] }, ahdaq: { mustawa: "loud" } }));
    const shakawa = tahaqqaq(tasmim.now());
    assertEquals(shakawa.length, 3);
    assertEquals(shakawa[0].includes("slack"), true);
    assertEquals(shakawa[1].includes("muhadatha"), true);
    assertEquals(shakawa[2].includes("loud"), true);
  });
});

test("tasmim: a daemon with no majlis says so", () => {
  fiDar((_, tasmim) => {
    assertEquals(tahaqqaq(tasmim.now()).length, 1);
    assertEquals(tahaqqaq(tasmim.now())[0].includes("majlis"), true);
  });
});
