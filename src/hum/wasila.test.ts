import { test, assertEquals, assertExists } from "../ikhtibar.ts";
import type { Tone } from "thrum";
import { KHUDDAM, Wasila, khadimMin, type NahlaHum } from "./wasila.ts";
import { AlatAlIksir } from "../alat/alat-al-iksir.ts";
import { withTestDb } from "../test-helpers.ts";

class NahlaWahm implements NahlaHum {
  id: string;
  constructor(khadim = "wahm") { this.id = `bee_${khadim}`; }
  mursal: Tone[] = [];
  #byChi = new Map<string, (t: any) => unknown>();
  #bySid = new Map<string, (t: Tone) => unknown>();
  #nestled: Array<() => unknown> = [];
  on(chi: string, fn: (t: any) => unknown) { this.#byChi.set(chi, fn); return this; }
  onSid(sid: string, fn: (t: Tone) => unknown) { this.#bySid.set(sid, fn); return this; }
  offSid(sid: string) { this.#bySid.delete(sid); return this; }
  onAny() { return this; }
  onNestled(fn: () => unknown) { this.#nestled.push(fn); return this; }
  onAstray() { return this; }
  onAdvisory() { return this; }
  #badaa = false;
  async start() {
    if (this.#badaa) throw new Error("this bee has already started");
    this.#badaa = true;
    for (const fn of this.#nestled) fn();
    this.sawt({ chi: "breath", sigils: {}, protoVersion: "0.8.0", tools: [{ name: "wasfa_iqra" }] });
  }
  send(t: Tone) { this.mursal.push(t); }
  async close() {}
  sawt(t: Tone) { ((t.sid && this.#bySid.get(t.sid)) ?? this.#byChi.get(t.chi))?.(t); }
  nataij() { return this.mursal.filter((t) => t.chi === "tendril-result") as Array<Tone<"tendril-result">>; }
}

async function intazir(f: () => boolean): Promise<void> {
  const azal = Date.now() + 3000;
  while (!f() && Date.now() < azal) await new Promise((r) => setTimeout(r, 10));
  assertEquals(f(), true);
}

function qim(warsha?: string) {
  const nuhul = new Map<string, NahlaWahm>();
  const sanaaNahla = (khadim: string) => {
    const n = nuhul.get(khadim) ?? new NahlaWahm(khadim);
    nuhul.set(khadim, n);
    return n;
  };
  const wasila = new Wasila({ sijill: new AlatAlIksir().sijill, warsha, sanaaNahla });
  return { nahla: nuhul.get("murshid") ?? sanaaNahla("murshid"), nuhul, wasila };
}

test("forager: a prompt carries the mun_* tools and fences nothing else", async () => {
  const { nahla, wasila } = qim();
  await wasila.ittasil();
  const jalsa = (await wasila.khalaqaJalsa("iksir-murshid", "t"))!;
  await wasila.sendPromptAsync(jalsa.id, "salam");
  const hathth = nahla.mursal.find((t) => t.chi === "prompt") as Tone<"prompt">;
  assertExists(hathth);
  assertEquals(hathth.sid, jalsa.id);
  assertEquals((hathth.tools as Array<{ name: string }>).some((t) => t.name === "mun_fasl"), true);
  assertEquals(hathth.allowedTools, undefined);
  wasila.qaf();
});

test("forager: blooms build in the workshop on this humd", async () => {
  const { nahla, wasila } = qim("/srv/warsha");
  await wasila.ittasil();
  const jalsa = (await wasila.khalaqaJalsa("iksir-murshid", "t"))!;
  await wasila.sendPromptAsync(jalsa.id, "salam");
  const hathth = nahla.mursal.find((t) => t.chi === "prompt") as Tone<"prompt">;
  assertEquals(hathth.cwd, "hum:///srv/warsha");
  wasila.qaf();
});

test("forager: unfurl grows the bloom, wilt hands it back; cell-ready pulse is the resume", async () => {
  const { nahla, wasila } = qim();
  await wasila.ittasil();
  const jalsa = (await wasila.khalaqaJalsa("iksir-murshid", "t"))!;
  const jawab = wasila.sendPrompt(jalsa.id, "salam", { timeoutMs: 2000 });
  nahla.sawt({ chi: "pulse", sid: jalsa.id, kind: "cell-ready", cell: "khaliyya-1" });
  nahla.sawt({ chi: "unfurl", sid: jalsa.id, petal: 0, kind: "text", text: "wa " });
  nahla.sawt({ chi: "unfurl", sid: jalsa.id, petal: 0, kind: "text", text: "alaykum" });
  nahla.sawt({ chi: "wilt", sid: jalsa.id, reason: "stop", nectar: { output: 3 } });
  assertEquals(await jawab, { success: true, response: "wa alaykum" });
  assertEquals(wasila.huwiyyatUsh(jalsa.id), "khaliyya-1");
  await wasila.sendPromptAsync(jalsa.id, "thumma");
  const thani = nahla.mursal.filter((t) => t.chi === "prompt").at(-1) as Tone<"prompt">;
  assertEquals(thani.resume, "khaliyya-1");
  wasila.qaf();
});

test("forager: error closes the bloom with its message", async () => {
  const { nahla, wasila } = qim();
  await wasila.ittasil();
  const jalsa = (await wasila.khalaqaJalsa("iksir-murshid", "t"))!;
  const jawab = wasila.sendPrompt(jalsa.id, "salam", { timeoutMs: 2000 });
  nahla.sawt({ chi: "error", sid: jalsa.id, message: "no-nurse", code: "no-nurse" });
  assertEquals(await jawab, { success: false, error: "no-nurse" });
  wasila.qaf();
});

test("forager: unknown tool reach answers isError tendril-result", async () => {
  const { nahla, wasila } = qim();
  await wasila.ittasil();
  const jalsa = (await wasila.khalaqaJalsa("iksir-murshid", "t"))!;
  nahla.sawt({ chi: "tendril-reach", sid: jalsa.id, callId: "c1", name: "mun_ghayr_mawjod", args: {} });
  await intazir(() => nahla.nataij().length === 1);
  assertEquals(nahla.nataij()[0].callId, "c1");
  assertEquals(nahla.nataij()[0].isError, true);
  wasila.qaf();
});

test("forager: valid reach dispatches body and answers output", async () => {
  await withTestDb(async () => {
    const { nahla, wasila } = qim();
    await wasila.ittasil();
    const jalsa = (await wasila.khalaqaJalsa("iksir-murshid", "t"))!;
    nahla.sawt({ chi: "tendril-reach", sid: jalsa.id, callId: "c3", name: "mun_iqra_mudawwana", args: { huwiyyatMurshid: "x" } });
    await intazir(() => nahla.nataij().length === 1);
    assertEquals(nahla.nataij()[0].callId, "c3");
    assertEquals(nahla.nataij()[0].isError, undefined);
    assertExists(nahla.nataij()[0].output);
    wasila.qaf();
  });
});

test("forager: ittasil twice starts each bee once", async () => {
  const { wasila } = qim();
  await wasila.ittasil();
  await wasila.ittasil();
  assertEquals(wasila.muttasil, true);
  wasila.qaf();
});

test("khuddam: a vessel named for its wasfa is the murshid's; the four khuddam are themselves", () => {
  assertEquals(khadimMin("iksir-arraf"), "arraf");
  assertEquals(khadimMin("iksir-munadi"), "munadi");
  assertEquals(khadimMin("iksir-mumayyiz"), "mumayyiz");
  assertEquals(khadimMin("iksir-murshid"), "murshid");
  assertEquals(khadimMin("GH-71"), "murshid");
  assertEquals(khadimMin("TEAM-9001"), "murshid");
  assertEquals(khadimMin("SANDBOX-pos"), "murshid");
});

test("khuddam: a wasfa's vessel prompts through the murshid bee, never a fifth", async () => {
  const { nuhul, wasila } = qim();
  await wasila.ittasil();
  const jalsa = (await wasila.khalaqaJalsa("GH-71", "apple-fm-worker"))!;
  assertEquals(await wasila.sendPromptAsync(jalsa.id, "ibda"), true);
  assertEquals(nuhul.get("murshid")!.mursal.filter((t) => t.chi === "prompt" && t.sid === jalsa.id).length, 1);
  assertEquals(nuhul.size, KHUDDAM.length);
  wasila.qaf();
});

test("khuddam: four bees, one per khadim, and a jalsa speaks through its own", async () => {
  const { nuhul, wasila } = qim();
  await wasila.ittasil();
  assertEquals([...nuhul.keys()].sort(), [...KHUDDAM].sort());
  assertEquals(wasila.huwiyya.includes("arraf=bee_arraf"), true);
  const oracle = (await wasila.khalaqaJalsa("iksir-arraf", "t"))!;
  await wasila.sendPromptAsync(oracle.id, "divine");
  assertEquals(nuhul.get("arraf")!.mursal.filter((t) => t.chi === "prompt").length, 1);
  assertEquals(nuhul.get("murshid")!.mursal.filter((t) => t.chi === "prompt").length, 0);
  nuhul.get("arraf")!.sawt({ chi: "tendril-reach", sid: oracle.id, callId: "c9", name: "mun_ghayr_mawjod", args: {} });
  await intazir(() => nuhul.get("arraf")!.nataij().length === 1);
  wasila.bassaLog("info", "kalima");
  assertEquals(nuhul.get("munadi")!.mursal.some((t) => t.chi === "log"), true);
  wasila.qaf();
});

test("forager: dismissing a jalsa sends cleanup and stops following", async () => {
  const { nahla, wasila } = qim();
  await wasila.ittasil();
  const jalsa = (await wasila.khalaqaJalsa("iksir-murshid", "t"))!;
  await wasila.mahaqaJalsa(jalsa.id);
  assertEquals(nahla.mursal.some((t) => t.chi === "cleanup" && t.sid === jalsa.id), true);
  wasila.qaf();
});
