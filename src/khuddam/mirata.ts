import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { HadathThehum } from "../types.ts";
import type { Wasila } from "../hum/wasila.ts";
import {
  jalabaWatermark,
  haddathaWatermark,
  haddathaAwAdkhalaJalsa,
  adkhalaHadathMirror,
  adkhalaSual,
  allamaJawabSual,
  jalabaKullJalasat,
} from "../../db/db.ts";
import { logger } from "../logging/logger.ts";

export function masarThehum(): string {
  const state = process.env.XDG_STATE_HOME ?? join(homedir(), ".local", "state");
  return join(state, "hum", "thehum");
}

export function tamyiAuthorKhatm(dir?: string): { author: string; seq: number } | null {
  let milafat: string[];
  try {
    milafat = readdirSync(dir ?? masarThehum()).filter((f) => f.endsWith(".ndjson")).sort();
  } catch {
    return null;
  }
  if (milafat.length === 0) return null;
  const akhir = readFileSync(join(dir ?? masarThehum(), milafat[milafat.length - 1]), "utf-8")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)
    .pop();
  if (!akhir) return null;
  try {
    const h = JSON.parse(akhir) as { author?: string; seq?: number };
    if (typeof h.author !== "string" || typeof h.seq !== "number") return null;
    return { author: h.author, seq: h.seq };
  } catch {
    return null;
  }
}

export async function tabbiqHadathMirata(h: HadathThehum): Promise<boolean> {
  if (h.chi === "log") {
    const huyul = (h.body as { fields?: Record<string, unknown> } | undefined)?.fields
      ?? ((h as unknown as { fields?: Record<string, unknown> }).fields ?? {});
    if (huyul.naw === "jalsa" && typeof huyul.huwiyya === "string") {
      const alan = new Date(h.ts_ms ?? Date.now()).toISOString();
      haddathaAwAdkhalaJalsa({
        id: typeof huyul.sidJalsa === "string" ? huyul.sidJalsa : `th-${h.author}-${h.seq}`,
        huwiyya: huyul.huwiyya,
        unwan: typeof huyul.unwan === "string" ? huyul.unwan : "",
        naw: typeof huyul.nawJalsa === "string" ? huyul.nawJalsa : "epic",
        hala: typeof huyul.hala === "string" ? huyul.hala : "fail",
        far: typeof huyul.far === "string" ? huyul.far : "",
        illa: typeof huyul.illa === "string" ? huyul.illa : undefined,
        unshiaFi: alan,
        akhirRisalaFi: alan,
        halaMufassala: {},
      });
      haddathaWatermark(h.author, Math.max(jalabaWatermark(h.author), h.seq));
      return true;
    }
    return false;
  }
  if (h.chi === "tool-call") {
    const body = (h.body ?? {}) as { toolName?: string; name?: string; args?: Record<string, unknown>; sid?: string };
    const ism = body.toolName ?? body.name ?? "majhul";
    const alan = new Date(h.ts_ms ?? Date.now()).toISOString();
    adkhalaHadathMirror({
      id: `th-${h.author}-${h.seq}`,
      naw: "pm",
      ada: ism,
      humulat: { ...(body.args ?? {}), sid: body.sid },
      unshiaFi: alan,
    });
    haddathaWatermark(h.author, Math.max(jalabaWatermark(h.author), h.seq));
    return true;
  }
  if (h.chi === "permission-ask") {
    const body = (h.body ?? {}) as {
      callId?: string;
      sid?: string;
      toolName?: string;
      message?: string;
      arg?: { questions?: Array<{ question?: string; options?: Array<{ label?: string }> }> };
    };
    if (!body.callId || !body.sid) return false;
    const jalsa = jalabaKullJalasat().find((j) => j.id === body.sid);
    if (!jalsa) {
      await logger.haDHHir("mirata", "sual without mirrored jalsa, kept in thehum", { sid: body.sid });
      haddathaWatermark(h.author, Math.max(jalabaWatermark(h.author), h.seq));
      return false;
    }
    const sual = body.arg?.questions?.[0];
    adkhalaSual({
      id: body.callId,
      sessionId: body.sid,
      question: sual?.question ?? body.message ?? body.toolName ?? "istijaba",
      options: sual?.options?.map((o) => o.label ?? "") ?? [],
    });
    haddathaWatermark(h.author, Math.max(jalabaWatermark(h.author), h.seq));
    return true;
  }
  if (h.chi === "release-permit") {
    const body = (h.body ?? {}) as {
      callId?: string;
      ok?: boolean;
      ext?: { "iksir-wasila"?: { answers?: Array<{ selected?: string[] }> } };
    };
    if (!body.callId || body.ok !== true) {
      haddathaWatermark(h.author, Math.max(jalabaWatermark(h.author), h.seq));
      return false;
    }
    const muntakhab = body.ext?.["iksir-wasila"]?.answers?.[0]?.selected?.join(", ");
    allamaJawabSual(body.callId, muntakhab ?? "ujiba abra al-nest");
    haddathaWatermark(h.author, Math.max(jalabaWatermark(h.author), h.seq));
    return true;
  }
  return false;
}

export async function istarjaaMirata(wasila: Wasila, dir?: string): Promise<number> {
  const khatm = tamyiAuthorKhatm(dir);
  if (!khatm) {
    await logger.haDHHir("mirata", "no thehum ring found, mirror sleeps");
    return 0;
  }
  const min = jalabaWatermark(khatm.author);
  const mujammaa: HadathThehum[] = [];
  wasila.wadaaMirata((h) => {
    if (h.author === khatm.author && h.seq > min) mujammaa.push(h);
  });
  if (!wasila.atlubBackfill(khatm.author, min + 1)) {
    await logger.sajjalKhata("mirata", "backfill request refused by wire");
    return 0;
  }
  const sukun = 2000;
  let akhirHadath = Date.now();
  const raqib = setInterval(() => {
    if (mujammaa.length > 0) akhirHadath = Date.now();
  }, 200);
  if (typeof (raqib as unknown as { unref?: unknown }).unref === "function") {
    (raqib as unknown as { unref: () => void }).unref();
  }
  while (Date.now() - akhirHadath < sukun) {
    await new Promise((r) => setTimeout(r, 100));
  }
  clearInterval(raqib);
  mujammaa.sort((a, b) => a.seq - b.seq);
  let tabaqa = 0;
  for (const h of mujammaa) {
    try {
      if (await tabbiqHadathMirata(h)) tabaqa++;
    } catch (err) {
      await logger.sajjalKhata("mirata", "mirror apply failed", { error: String(err) });
    }
  }
  await logger.akhbar("mirata", `mirror applied ${tabaqa}/${mujammaa.length} events for ${khatm.author}`);
  return tabaqa;
}
