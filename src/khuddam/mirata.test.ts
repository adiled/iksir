import { test, assertEquals, assertExists } from "../ikhtibar.ts";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtempSync, writeFileSync } from "node:fs";
import { Wasila } from "../hum/wasila.ts";
import type { HadathThehum } from "../types.ts";
import { withTestDb } from "../test-helpers.ts";
import { tamyiAuthorKhatm, tabbiqHadathMirata } from "./mirata.ts";
import {
  jalabaWatermark,
  jalabaKullJalasat,
  jalabaAhdathGhairMuaalaja,
} from "../../db/db.ts";

function nashThehum(sutur: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), "thehum-"));
  writeFileSync(join(dir, "2026-10-16.ndjson"), sutur.join("\n") + "\n");
  return dir;
}

test("mirata: tamyiAuthorKhatm reads author and seq from ring tail", () => {
  const dir = nashThehum([
    JSON.stringify({ chi: "prompt", author: "h-bee-1", seq: 1, ts_ms: 1, rid: "r1", body: {} }),
    JSON.stringify({ chi: "finish", author: "h-bee-1", seq: 2, ts_ms: 2, rid: "r2", body: {} }),
  ]);
  const khatm = tamyiAuthorKhatm(dir);
  assertExists(khatm);
  assertEquals(khatm.author, "h-bee-1");
  assertEquals(khatm.seq, 2);
});

test("mirata: tamyiAuthorKhatm sleeps on missing ring", () => {
  assertEquals(tamyiAuthorKhatm(join(tmpdir(), "la-mathi-la-shay")), null);
});

test("mirata: log jalsa event upserts roster and watermark", async () => {
  await withTestDb(async () => {
    const h: HadathThehum = {
      chi: "log",
      author: "h-bee-1",
      seq: 7,
      ts_ms: Date.now(),
      body: {
        fields: {
          naw: "jalsa",
          hadath: "khalaqa",
          huwiyya: "TEAM-9000",
          unwan: "Mirror Hall",
          nawJalsa: "epic",
          hala: "fail",
          far: "epic/team-9000",
          sidJalsa: "nest-sid-9000",
        },
      },
    };
    assertEquals(await tabbiqHadathMirata(h), true);
    const jalasat = jalabaKullJalasat();
    assertEquals(jalasat.length, 1);
    assertEquals(jalasat[0].huwiyya, "TEAM-9000");
    assertEquals(jalasat[0].id, "nest-sid-9000");
    assertEquals(jalabaWatermark("h-bee-1"), 7);
  });
});

test("mirata: tool-call event lands in pm ledger with stable id", async () => {
  await withTestDb(async () => {
    const h: HadathThehum = {
      chi: "tendril-reach",
      author: "h-bee-1",
      seq: 8,
      ts_ms: Date.now(),
      body: { name: "mun_naqsh", args: { huwiyyatWasfa: "W-1" }, sid: "s-1" },
    };
    assertEquals(await tabbiqHadathMirata(h), true);
    assertEquals(await tabbiqHadathMirata(h), true);
    const ahdath = jalabaAhdathGhairMuaalaja("pm");
    assertEquals(ahdath.length, 1);
    assertEquals(jalabaWatermark("h-bee-1"), 8);
  });
});

test("mirata: foreign chi is ignored", async () => {
  await withTestDb(async () => {
    assertEquals(await tabbiqHadathMirata({ chi: "chunk", author: "h", seq: 1, body: {} }), false);
  });
});

test("mirata: bassaLog emits well-formed log tone", async () => {
  const mursal: Array<Record<string, unknown>> = [];
  const nahla = {
    id: "bee_wahm",
    on(chi: string, fn: (t: unknown) => unknown) { if (chi === "breath") this.breath = fn; return this; },
    breath: undefined as undefined | ((t: unknown) => unknown),
    onSid() { return this; }, offSid() { return this; }, onAny() { return this; },
    onNestled() { return this; }, onAstray() { return this; }, onAdvisory() { return this; },
    async start() { this.breath?.({ chi: "breath", sigils: {}, protoVersion: "0.8.0" }); },
    send(t: Record<string, unknown>) { mursal.push(t); },
    async close() {},
  };
  const wasila = new Wasila({ nahla: nahla as never });
  await wasila.ittasil();
  wasila.bassaLog("info", "jalsa khalaqa TEAM-1", { naw: "jalsa", hadath: "khalaqa" });
  const log = mursal.filter((t) => t.chi === "log");
  assertEquals(log.length, 1);
  assertEquals(log[0].level, "info");
  assertEquals((log[0].fields as Record<string, unknown>).naw, "jalsa");
  wasila.qaf();
});
