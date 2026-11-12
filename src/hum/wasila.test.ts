import { test, assertEquals, assertExists } from "../ikhtibar.ts";
import type { Tone } from "thrum";
import { KHUDDAM, Wasila, khadimMin, type NahlaHum } from "./wasila.ts";
import { AlatAlIksir } from "../alat/alat-al-iksir.ts";
import { withTestDb, makeConfig } from "../test-helpers.ts";
import type { Tasmim } from "../config.ts";

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
  #astray: Array<() => unknown> = [];
  onAstray(fn: () => unknown) { this.#astray.push(fn); return this; }
  dhalla() { for (const fn of this.#astray) fn(); }
  tanaffas() { this.sawt({ chi: "breath", sigils: {}, protoVersion: "0.8.0", models: [{ id: "claude-opus-5-5", hive: "claude-cli" }], tools: [{ name: "wasfa_iqra" }] }); }
  onAdvisory() { return this; }
  #badaa = false;
  async start() {
    if (this.#badaa) throw new Error("this bee has already started");
    this.#badaa = true;
    for (const fn of this.#nestled) fn();
    this.tanaffas();
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

function qim(tasmim?: Tasmim) {
  const nuhul = new Map<string, NahlaWahm>();
  const sanaaNahla = (khadim: string) => {
    const n = nuhul.get(khadim) ?? new NahlaWahm(khadim);
    nuhul.set(khadim, n);
    return n;
  };
  const wasila = new Wasila({ sijill: new AlatAlIksir().sijill, sanaaNahla, tasmim });
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

test("khuddam: a vessel named for its wasfa is the murshid's; the khuddam are themselves", () => {
  assertEquals(khadimMin("iksir-sayrafi"), "sayrafi");
  assertEquals(khadimMin("iksir-munadi"), "munadi");
  assertEquals(khadimMin("iksir-mumayyiz"), "mumayyiz");
  assertEquals(khadimMin("iksir-murshid"), "murshid");
  assertEquals(khadimMin("GH-71"), "murshid");
  assertEquals(khadimMin("TEAM-9001"), "murshid");
  assertEquals(khadimMin("SANDBOX-pos"), "murshid");
});

test("khuddam: a wasfa's vessel prompts through the murshid bee, never one of its own", async () => {
  const { nuhul, wasila } = qim();
  await wasila.ittasil();
  const jalsa = (await wasila.khalaqaJalsa("GH-71", "apple-fm-worker"))!;
  assertEquals(await wasila.sendPromptAsync(jalsa.id, "ibda"), true);
  assertEquals(nuhul.get("murshid")!.mursal.filter((t) => t.chi === "prompt" && t.sid === jalsa.id).length, 1);
  assertEquals(nuhul.size, KHUDDAM.length);
  wasila.qaf();
});

test("khuddam: one bee per khadim, and a jalsa speaks through its own", async () => {
  const { nuhul, wasila } = qim();
  await wasila.ittasil();
  assertEquals([...nuhul.keys()].sort(), [...KHUDDAM].sort());
  assertEquals(wasila.huwiyya.includes("sayrafi=bee_sayrafi"), true);
  const sayrafi = (await wasila.khalaqaJalsa("iksir-sayrafi", "t"))!;
  await wasila.sendPromptAsync(sayrafi.id, "assay");
  assertEquals(nuhul.get("sayrafi")!.mursal.filter((t) => t.chi === "prompt").length, 1);
  assertEquals(nuhul.get("murshid")!.mursal.filter((t) => t.chi === "prompt").length, 0);
  nuhul.get("sayrafi")!.sawt({ chi: "tendril-reach", sid: sayrafi.id, callId: "c9", name: "mun_ghayr_mawjod", args: {} });
  await intazir(() => nuhul.get("sayrafi")!.nataij().length === 1);
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

test("forager: a ruqya is rendered per prompt — the roster's words, overridden by the wasfa's own", async () => {
  const { nuhul, wasila } = qim(makeConfig({ khabath: { majlis: ["telegram"], kur: ["github", "gitlab"], sijillat: ["linear"] } }));
  await wasila.ittasil();
  const jalsa = (await wasila.khalaqaJalsa("iksir-sayrafi", "t"))!;
  await wasila.sendPromptAsync(jalsa.id, "salam", { agent: "iksir-sayrafi" });
  await wasila.sendPromptAsync(jalsa.id, "salam", { agent: "iksir-sayrafi", kalimat: { kur: "gitlab" } });
  const [awwal, thani] = nuhul.get("sayrafi")!.mursal.filter((t) => t.chi === "prompt") as Array<Tone<"prompt">>;
  assertEquals(awwal.systemPrompt?.includes("kūr is **github, gitlab**"), true);
  assertEquals(thani.systemPrompt?.includes("kūr is **gitlab**"), true);
  assertEquals(thani.systemPrompt?.includes("{{"), false);
  wasila.qaf();
});

test("khuddam: an instrument marked khass reaches only its own khadim, and the mark never rides the wire", async () => {
  const { nuhul, wasila } = qim();
  const alat = new AlatAlIksir();
  alat.sijill.sajjil({ name: "mun_sirri", khass: "munadi", description: "his", inputSchema: { type: "object", properties: {} } }, () => "ok");
  const w = new Wasila({ sijill: alat.sijill, sanaaNahla: (k) => { const n = nuhul.get(k) ?? new NahlaWahm(k); nuhul.set(k, n); return n; } });
  await w.ittasil();
  const majlis = (await w.khalaqaJalsa("iksir-munadi", "t"))!;
  const murshid = (await w.khalaqaJalsa("GH-1", "t"))!;
  await w.sendPromptAsync(majlis.id, "a");
  await w.sendPromptAsync(murshid.id, "b");
  const liMunadi = nuhul.get("munadi")!.mursal.find((t) => t.chi === "prompt") as Tone<"prompt">;
  const liMurshid = nuhul.get("murshid")!.mursal.find((t) => t.chi === "prompt") as Tone<"prompt">;
  assertEquals((liMunadi.tools as Array<{ name: string; khass?: string }>).some((t) => t.name === "mun_sirri"), true);
  assertEquals((liMunadi.tools as Array<{ khass?: string }>).every((t) => t.khass === undefined), true);
  assertEquals((liMurshid.tools as Array<{ name: string }>).some((t) => t.name === "mun_sirri"), false);
  w.qaf();
  void wasila;
});

test("khuddam: a vessel's trail keeps what it said and what it reached for, whole petals only", async () => {
  const { nahla, wasila } = qim();
  await wasila.ittasil();
  const jalsa = (await wasila.khalaqaJalsa("GH-9", "t"))!;
  await wasila.sendPromptAsync(jalsa.id, "ibda");
  const sid = jalsa.id;
  nahla.sawt({ chi: "unfurl", sid, petal: 1, kind: "text", text: "I will run " });
  nahla.sawt({ chi: "unfurl", sid, petal: 1, kind: "text", text: "the tests.", closed: true });
  nahla.sawt({ chi: "unfurl", sid, petal: 2, kind: "tendril", callId: "c1", name: "bash", sap: '{"command":' });
  nahla.sawt({ chi: "unfurl", sid, petal: 2, kind: "tendril", callId: "c1", sap: '"npm test"}', closed: true });
  nahla.sawt({ chi: "unfurl", sid, petal: 3, kind: "grasp", callId: "c1", result: "ok", closed: true });
  nahla.sawt({ chi: "unfurl", sid, petal: 4, kind: "text", text: "half said" });
  assertEquals(wasila.athar(sid).map((s) => s.slice(9)), ["I will run the tests.", '→ bash {"command":"npm test"}']);
  nahla.sawt({ chi: "wilt", sid, reason: "done" });
  assertEquals(wasila.athar(sid).length, 3);
  assertEquals(wasila.athar(sid)[2].slice(9), "half said");
  await wasila.mahaqaJalsa(sid);
  assertEquals(wasila.athar(sid), []);
  wasila.qaf();
});

test("khuddam: the nest's models are read from the breath", async () => {
  const { wasila } = qim();
  await wasila.ittasil();
  assertEquals(wasila.namadhij(), ["claude-opus-5-5"]);
  wasila.qaf();
});

test("forager: after humd goes astray and breathes again, every vessel is attached anew", async () => {
  const { nahla, wasila } = qim();
  await wasila.ittasil();
  const a = (await wasila.khalaqaJalsa("GH-1", "a"))!;
  const b = (await wasila.khalaqaJalsa("GH-2", "b"))!;
  assertEquals(nahla.mursal.filter((t) => t.chi === "attach").length, 0);
  nahla.dhalla();
  nahla.tanaffas();
  assertEquals(nahla.mursal.filter((t) => t.chi === "attach").map((t) => t.sid).sort(), [a.id, b.id].sort());
  wasila.istaadaJalsa({ id: "old-sid", projectId: "iksir", huwiyyatWasfa: "GH-3", title: "c", status: "sakin", createdAt: new Date(), lastMessageAt: new Date() }, "cell-3");
  assertEquals(nahla.mursal.filter((t) => t.chi === "attach" && t.sid === "old-sid").length, 1);
  wasila.qaf();
});

test("forager: each prompt carries the blooms before it as a graft, with what grew; warmth and seed when asked", async () => {
  const { nahla, wasila } = qim();
  await wasila.ittasil();
  const jalsa = (await wasila.khalaqaJalsa("GH-7", "t"))!;
  const sid = jalsa.id;
  await wasila.sendPromptAsync(sid, "first");
  nahla.sawt({ chi: "unfurl", sid, petal: 1, kind: "text", text: "I looked.", closed: true });
  nahla.sawt({ chi: "unfurl", sid, petal: 2, kind: "tendril", callId: "c1", name: "bash", sap: '{"command":"ls"}', closed: true });
  nahla.sawt({ chi: "unfurl", sid, petal: 3, kind: "grasp", callId: "c1", result: "a b", closed: true });
  nahla.sawt({ chi: "wilt", sid, reason: "done" });
  const awwal = nahla.mursal.filter((t) => t.chi === "prompt")[0] as Tone<"prompt">;
  assertEquals(awwal.graft, undefined);

  await wasila.sendPromptAsync(sid, "second", { harara: 0, badhra: 7 });
  const thani = nahla.mursal.filter((t) => t.chi === "prompt")[1] as Tone<"prompt">;
  assertEquals(thani.temperature, 0);
  assertEquals(thani.seed, 7);
  const graft = thani.graft as Array<{ content: Array<{ text?: string }>; grew: Array<{ kind: string; name?: string; args?: unknown; result?: unknown }> }>;
  assertEquals(graft.length, 1);
  assertEquals(graft[0].content[0].text, "first");
  assertEquals(graft[0].grew.map((p) => p.kind), ["text", "tendril", "grasp"]);
  assertEquals(graft[0].grew[1].name, "bash");
  assertEquals(graft[0].grew[1].args, { command: "ls" });
  assertEquals(graft[0].grew[2].result, "a b");
  assertEquals(wasila.azhar(sid).length, 2);
  wasila.qaf();
});
