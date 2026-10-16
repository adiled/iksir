import { test, assertEquals, assertExists } from "../ikhtibar.ts";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
    assertEquals(tabbiqHadathMirata(h), true);
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
      chi: "tool-call",
      author: "h-bee-1",
      seq: 8,
      ts_ms: Date.now(),
      body: { toolName: "mun_naqsh", args: { huwiyyatWasfa: "W-1" }, sid: "s-1" },
    };
    assertEquals(tabbiqHadathMirata(h), true);
    assertEquals(tabbiqHadathMirata(h), true);
    const ahdath = jalabaAhdathGhairMuaalaja("pm");
    assertEquals(ahdath.length, 1);
    assertEquals(jalabaWatermark("h-bee-1"), 8);
  });
});

test("mirata: foreign chi is ignored", async () => {
  await withTestDb(async () => {
    assertEquals(tabbiqHadathMirata({ chi: "chunk", author: "h", seq: 1, body: {} }), false);
  });
});

test("mirata: bassaLog emits well-formed log tone", async () => {
  const dir = mkdtempSync(join(tmpdir(), "thrum-nash-"));
  const masar = join(dir, "thrum.sock");
  const makhudha: Array<Record<string, unknown>> = [];
  const khadm = createServer((wasl) => {
    let buf = "";
    wasl.on("data", (d: Buffer) => {
      buf += d.toString();
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        if (!line) continue;
        const t = JSON.parse(line) as Record<string, unknown>;
        if (t.chi === "log") makhudha.push(t);
      }
    });
    wasl.write(JSON.stringify({ chi: "breath", protoVersion: "0.7.0", sessions: [] }) + "\n");
  });
  await new Promise<void>((hal) => khadm.listen(masar, () => hal()));
  const wasila = new Wasila({ socket: masar });
  await wasila.ishgal();
  wasila.bassaLog("info", "jalsa khalaqa TEAM-1", { naw: "jalsa", hadath: "khalaqa" });
  const azal = Date.now() + 3000;
  while (makhudha.length === 0 && Date.now() < azal) {
    await new Promise((r) => setTimeout(r, 25));
  }
  assertEquals(makhudha.length, 1);
  assertEquals(makhudha[0].level, "info");
  assertEquals((makhudha[0].fields as Record<string, unknown>).naw, "jalsa");
  wasila.qaf();
  khadm.close();
});
