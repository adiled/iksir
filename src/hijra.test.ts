import { test, assertEquals, assert } from "./ikhtibar.ts";
import { tmpdir } from "node:os";
import { mkdtempSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { Tasmim } from "./config.ts";
import { hajir } from "./hijra.ts";

function fiDar(fn: (dir: string, tasmim: Tasmim, env: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "iksir-hijra-"));
  try {
    fn(dir, new Tasmim(dir), join(dir, ".env"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("hijra: the old .env and wasfat.khabath are carried over, and the .env removed", () => {
  fiDar((dir, tasmim, env) => {
    writeFileSync(join(dir, "iksir.json"), JSON.stringify({ wasfat: { khabath: "github" }, hum: { namudhaj: "m" } }));
    writeFileSync(env, [
      "# old",
      "TELEGRAM_BOT_TOKEN=abc:def",
      'TELEGRAM_CHAT_ID="123"',
      "TELEGRAM_DISPATCH_TOPIC_ID=14",
      "IKSIR_WORKSHOP_PATHS=/x",
      "TELEGRAM_GROUP_ID=",
    ].join("\n"));
    const aqwal = hajir(tasmim, env);
    assertEquals(tasmim.khabath().majlis, ["telegram"]);
    assertEquals(tasmim.khabath().kur, ["github"]);
    assertEquals(tasmim.khabath().sijillat, ["github"]);
    assertEquals(tasmim.khabath().telegram, { muhadatha: "123", mawduuIrsal: 14 });
    assertEquals(tasmim.sirr("telegram.ramz"), "abc:def");
    assertEquals(tasmim.namudhaj(), "m");
    assertEquals((tasmim.iqraKham().wasfat as Record<string, unknown>).khabath, undefined);
    assertEquals(existsSync(env), false);
    assert(aqwal.some((q) => q.includes("IKSIR_WORKSHOP_PATHS") && q.includes("dropped")));
    assert(aqwal.some((q) => q.includes("removed")));
  });
});

test("hijra: what the new places already hold stands", () => {
  fiDar((dir, tasmim, env) => {
    writeFileSync(join(dir, "iksir.json"), JSON.stringify({ khabath: { majlis: ["telegram"], kur: ["gitlab"], telegram: { muhadatha: "9" } }, wasfat: { khabath: "github" } }));
    writeFileSync(join(dir, "asrar"), "telegram.ramz=kept\n");
    writeFileSync(env, "TELEGRAM_BOT_TOKEN=new\nTELEGRAM_CHAT_ID=1\n");
    hajir(tasmim, env);
    assertEquals(tasmim.khabath().kur, ["gitlab"]);
    assertEquals(tasmim.khabath().sijillat, ["github"]);
    assertEquals(tasmim.khabath().telegram?.muhadatha, "9");
    assertEquals(tasmim.sirr("telegram.ramz"), "kept");
    assertEquals(existsSync(env), false);
  });
});

test("hijra: a .env with a line iksir does not know is left, and named", () => {
  fiDar((_, tasmim, env) => {
    writeFileSync(env, "TELEGRAM_BOT_TOKEN=t\nSOMETHING_ELSE=1\n");
    const aqwal = hajir(tasmim, env);
    assertEquals(tasmim.sirr("telegram.ramz"), "t");
    assertEquals(existsSync(env), true);
    assert(aqwal.some((q) => q.includes("kept") && q.includes("SOMETHING_ELSE")));
  });
});

test("hijra: with nothing old it says nothing and touches nothing", () => {
  fiDar((_, tasmim, env) => {
    assertEquals(hajir(tasmim, env), []);
    assertEquals(tasmim.mawjud(), false);
  });
});
