import { Chi, rid, sigil } from "thrum";
import type { Tone } from "thrum";
import { readFileSync } from "node:fs";
import { join as joinMasar } from "node:path";
import { Nahla, masar_thrum } from "../../hum/bee.ts";
import type { JalsatHum, HadathThrum, HadathThehum, RisalaMurshid, SijillAlat, JawabSual } from "../types.ts";
import { DEFAULT_TIMEOUT_MS } from "../constants.ts";
import { logger } from "../logging/logger.ts";

const ASAS = "iksir";

type JawabDawr = { success: boolean; response?: string; error?: string };

interface DawrTawaqquf {
  qataa: string[];
  hal: (jawab: JawabDawr) => void;
  zaman: number;
}

export class Wasila {
  #nahla: Nahla;
  #masarThrum: string;
  #muttasil = false;
  #wasfThrum: string | null = null;
  #jalasat = new Map<string, JalsatHum>();
  #adwar = new Map<string, DawrTawaqquf>();
  #adwarAkhira = new Map<string, { zaman: number; usage?: unknown; khata?: string }>();
  #asmas = 0;
  #muntazir: Array<(h: HadathThrum) => void> = [];
  #hawadith: HadathThrum[] = [];
  #sijill: SijillAlat | null = null;
  #mirata: Array<(h: HadathThehum) => void> = [];
  #namudhaj?: string;
  #ruqan = new Map<string, string>();

  constructor(tasmim?: { miqbas?: string; namudhaj?: string; sijill?: SijillAlat }) {
    this.#masarThrum = tasmim?.miqbas ?? masar_thrum();
    this.#namudhaj = tasmim?.namudhaj;
    this.#sijill = tasmim?.sijill ?? null;
    const adawat = this.#sijill?.adawat() ?? [];
    this.#nahla = new Nahla({
      hive: "iksir-wasila",
      prefix: "fbee",
      version: "1.0.0",
      bee: ["forager"],
      chis: [
        Chi.hello, Chi.breath, Chi.echo, Chi.prompt, Chi.chunk, Chi.finish,
        Chi.sessionReady, Chi.pulse, Chi.error, Chi.curate, Chi.cleanup,
        Chi.cancel, Chi.releasePermit, Chi.permissionAsk,
        Chi.toolCall, Chi.toolResult,
      ],
      ...(adawat.length > 0 ? { tools: adawat } : {}),
      propensity: { statefulness: "convention-stateful", richness: "medium", wire: "iksir/khudam" },
      log: (m) => void logger.akhbar("wasila", m),
    });

    this.#nahla.on(Chi.breath, (t) => {
      this.#muttasil = true;
      this.#wasfThrum = (t as { protoVersion?: string }).protoVersion ?? null;
    });

    this.#nahla.on(Chi.chunk, (t) => this.#jamaDawr(t));
    this.#nahla.on(Chi.finish, (t) => this.#ikmalDawr(t));
    this.#nahla.on(Chi.error, (t) => this.#ikmalDawr(t));

    this.#nahla.on(Chi.sessionReady, (t) => {
      const sid = t.sid as string | undefined;
      const nestId = (t as { nestId?: string }).nestId;
      if (sid && nestId) {
        const jalsa = this.#jalasat.get(sid);
        if (jalsa) jalsa.nestId = nestId;
      }
      this.nasharHadath("session-ready", t as unknown as Record<string, unknown>);
    });
    this.#nahla.on(Chi.pulse, (t) => this.nasharHadath("pulse", t as unknown as Record<string, unknown>));
    this.#nahla.on(Chi.permissionAsk, (t) => {
      this.nasharHadath("permission-ask", t as unknown as Record<string, unknown>);
      const body = t as unknown as {
        callId?: string;
        rid?: string;
        sid?: string;
        questions?: unknown;
        question?: unknown;
        message?: unknown;
        name?: unknown;
      };
      const asila = Array.isArray(body.questions)
        ? body.questions
        : (typeof (body.question ?? body.message ?? body.name) === "string"
          ? [{
            header: String(body.name ?? "permission"),
            question: String(body.question ?? body.message ?? body.name),
            options: [
              { label: "allow", description: "Permit this action" },
              { label: "deny", description: "Refuse this action" },
            ],
          }]
          : []);
      this.nasharHadath("question.asked", {
        id: String(body.callId ?? (t as { rid?: string }).rid ?? ""),
        sessionID: typeof body.sid === "string" ? body.sid : "",
        questions: asila,
        ...(body.callId ? { tool: { messageID: "", callID: String(body.callId) } } : {}),
      });
    });
    this.#nahla.on(Chi.toolCall, (t) => void this.#ajabaNida(t));
    this.#nahla.on("backfill-event", (t) => {
      const hadath = (t.event ?? t) as unknown as HadathThehum;
      for (const fn of this.#mirata) {
        try {
          fn(hadath);
        } catch (err) {
          void logger.sajjalKhata("wasila", "mirror failed", { error: String(err) });
        }
      }
      this.nasharHadath("backfill-event", t as unknown as Record<string, unknown>);
    });
  }

  get muttasil(): boolean {
    return this.#muttasil;
  }

  get masarThrum(): string {
    return this.#masarThrum;
  }

  get wasfaThrum(): string | null {
    return this.#wasfThrum;
  }

  async ittasil(): Promise<void> {
    await this.#nahla.connect(this.#masarThrum);
    const azal = Date.now() + 5000;
    while (!this.#muttasil && Date.now() < azal) {
      await new Promise((r) => setTimeout(r, 50));
    }
    if (!this.#muttasil) {
      throw new KhataWasila(`thrum socket did not breathe: ${this.#masarThrum}`);
    }
  }

  qaf(): void {
    this.#nahla.close();
    this.#muttasil = false;
  }

  async isHealthy(): Promise<boolean> {
    return this.#muttasil;
  }

  async getVersion(): Promise<string | null> {
    return this.#wasfThrum;
  }

  khalaqaSid(): string {
    const thiqa = `${Date.now().toString(36)}-${(++this.#asmas).toString(36)}`;
    return `${sigil(ASAS, thiqa)}-${thiqa}`;
  }

  async khalaqaJalsa(huwiyyatWasfa: string, title: string): Promise<JalsatHum | null> {
    const wadem = new Date();
    const jalsa: JalsatHum = {
      id: this.khalaqaSid(),
      projectId: ASAS,
      huwiyyatWasfa,
      title,
      status: "sakin",
      createdAt: wadem,
      lastMessageAt: wadem,
    };
    this.#jalasat.set(jalsa.id, jalsa);
    await logger.akhbar("wasila", `Created session ${jalsa.id} for ${huwiyyatWasfa}`);
    return jalsa;
  }

  async jalabJalsa(sid: string): Promise<JalsatHum | null> {
    const j = this.#jalasat.get(sid);
    if (!j) return null;
    j.lastMessageAt = new Date(Math.max(j.lastMessageAt.getTime(), this.#zamanDawrAkhira(sid)));
    return j;
  }

  async listSessions(): Promise<JalsatHum[]> {
    return [...this.#jalasat.values()];
  }

  async mahaqaJalsa(sid: string): Promise<boolean> {
    const wasJalsa = this.#jalasat.has(sid);
    this.#nahla.emit(Chi.cleanup, { sid });
    this.#jalasat.delete(sid);
    this.#adwarAkhira.delete(sid);
    this.#inthaDawr(sid, { success: false, error: "session dismissed" });
    return wasJalsa;
  }

  #ruqya(ism: string): string | undefined {
    const mahfuz = this.#ruqan.get(ism);
    if (mahfuz !== undefined) return mahfuz || undefined;
    const maskan = new URL("../../prompts/", import.meta.url).pathname;
    let nass = "";
    try {
      nass = readFileSync(joinMasar(maskan, `${ism}.md`), "utf-8");
    } catch {
      void logger.haDHHir("wasila", `No ruqya found for ${ism}; prompting without one`);
    }
    this.#ruqan.set(ism, nass);
    return nass || undefined;
  }

  async sendPrompt(
    sid: string,
    prompt: string,
    options?: { model?: { providerID: string; modelID: string }; agent?: string; system?: string; cwd?: string; disallowedTools?: string[]; timeoutMs?: number },
  ): Promise<{ success: boolean; response?: string; error?: string }> {
    const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (!this.#muttasil) {
      return { success: false, error: "thrum is not connected" };
    }

        const muntazar = new Promise<JawabDawr>((hal) => {
      const sabbq = this.#adwar.get(sid);
      sabbq?.hal({ success: false, error: "stale prompt superseded" });
      this.#adwar.set(sid, { qataa: [], hal, zaman: Date.now() });
    });
    const from = this.#nahla.hid;
    const jalsa = this.#jalasat.get(sid);
    const namudhaj = options?.model?.modelID ?? this.#namudhaj;
    const nizam = options?.system ?? (options?.agent ? this.#ruqya(options.agent) : undefined);
    const tayara = this.#nahla.send({
      chi: Chi.prompt,
      rid: rid(),
      from,
      sid,
      hive: ASAS,
      text: prompt,
      content: prompt,
      ...(namudhaj ? { modelId: namudhaj } : {}),
      ...(nizam ? { systemPrompt: nizam } : {}),
      ...(jalsa?.nestId ? { resume: jalsa.nestId } : {}),
      ...(options?.cwd ? { cwd: options.cwd } : {}),
      ...(options?.disallowedTools ? { disallowedTools: options.disallowedTools } : {}),
    } as Tone);

    if (!tayara) {
      this.#inthaDawr(sid, { success: false, error: "wire refused the tone" });
    }

    const muntaqi = new Promise<never>((_, raf) => {
      const muqqit = setTimeout(() => raf(new KhataWasila(`prompt timed out after ${timeoutMs}ms`)), timeoutMs);
      if (typeof (muqqit as unknown as { unref?: unknown }).unref === "function") {
        (muqqit as unknown as { unref: () => void }).unref();
      }
    });

    try {
      return await Promise.race([muntazar, muntaqi]);
    } catch (error) {
      return { success: false, error: String(error) };
    } finally {
      this.#adwar.delete(sid);
    }
  }

  async sendPromptAsync(
    sid: string,
    prompt: string,
    options?: { model?: { providerID: string; modelID: string }; agent?: string; system?: string; cwd?: string; disallowedTools?: string[] },
  ): Promise<boolean> {
    if (!this.#muttasil) return false;
    const jalsa = this.#jalasat.get(sid);
    const namudhaj = options?.model?.modelID ?? this.#namudhaj;
    const nizam = options?.system ?? (options?.agent ? this.#ruqya(options.agent) : undefined);
    const tayara = this.#nahla.send({
      chi: Chi.prompt,
      rid: rid(),
      from: this.#nahla.hid,
      sid,
      hive: ASAS,
      text: prompt,
      content: prompt,
      ...(namudhaj ? { modelId: namudhaj } : {}),
      ...(nizam ? { systemPrompt: nizam } : {}),
      ...(jalsa?.nestId ? { resume: jalsa.nestId } : {}),
      ...(options?.cwd ? { cwd: options.cwd } : {}),
      ...(options?.disallowedTools ? { disallowedTools: options.disallowedTools } : {}),
    } as Tone);
    await logger.akhbar("wasila", `Sent async prompt to session ${sid}`);
    return tayara;
  }

  async abortSession(sid: string): Promise<boolean> {
    return this.#nahla.emit(Chi.cancel, { sid });
  }

  async jalabJalsaStatuses(): Promise<Record<string, string>> {
    const natija: Record<string, string> = {};
    for (const id of this.#jalasat.keys()) {
      natija[id] = this.#adwar.has(id) ? "busy" : "sakin";
    }
    return natija;
  }

  istaadaJalsa(jalsa: JalsatHum, nestId?: string): void {
    if (this.#jalasat.has(jalsa.id)) return;
    this.#jalasat.set(jalsa.id, { ...jalsa, nestId });
  }

  huwiyyatUsh(sid: string): string | undefined {
    return this.#jalasat.get(sid)?.nestId;
  }

  async jalabRisalaCount(sid: string): Promise<{ total: number; assistant: number; user: number } | null> {
    const jalsa = this.#jalasat.get(sid);
    if (!jalsa) return null;
    const jumla = this.#adwarAkhiraCount(sid);
    return { total: jumla, assistant: this.#adwarAkhira.has(sid) ? 1 : 0, user: jumla };
  }

  async getLastAssistantMessage(sid: string): Promise<RisalaMurshid | null> {
    const dawr = this.#adwarAkhira.get(sid);
    if (!dawr) return null;
    return {
      id: sid,
      createdAt: dawr.zaman,
      tokensOutput: (dawr.usage as { usage?: { output?: number } })?.usage?.output ?? 0,
      cost: 0,
      error: dawr.khata,
    };
  }

  async summarizeSession(sid: string): Promise<boolean> {
    const tayara = this.#nahla.emit(Chi.curate, { sid });
    if (tayara) {
      await logger.akhbar("wasila", `Curated jalsa ${sid}`);
      this.nasharHadath("session.compacted", { sessionID: sid });
    }
    return tayara;
  }

  bassaLog(mustawa: string, risala: string, huyul?: Record<string, unknown>): boolean {
    return this.#nahla.emit(Chi.log, {
      level: mustawa,
      message: risala,
      ...(huyul ? { fields: huyul } : {}),
    });
  }

  wadaaMirata(fn: (h: HadathThehum) => void): void {
    this.#mirata.push(fn);
  }

  atlubBackfill(author: string, from: number): boolean {
    return this.#nahla.emit(Chi.backfill, { author, from });
  }

  async mayyaza(prompt: string): Promise<{ success: boolean; response?: string; error?: string }> {
    const jalsa = await this.khalaqaJalsa("iksir-mumayyiz", "Iksir Tamyiz");
    if (!jalsa) {
      return { success: false, error: "failed to create mumayyiz session" };
    }
    try {
      return await this.sendPrompt(jalsa.id, prompt);
    } finally {
      await this.mahaqaJalsa(jalsa.id);
    }
  }

  async *subscribeToEvents(signal?: AbortSignal): AsyncGenerator<HadathThrum> {
    while (!signal?.aborted) {
      const hadath = this.#hawadith.shift();
      if (hadath) {
        yield hadath;
        continue;
      }
      yield await new Promise<HadathThrum>((hal) => this.#muntazir.push(hal));
    }
    this.#hawadith = [];
    for (const muntazir of this.#muntazir) {
      muntazir(this.#hadathWaqt());
    }
    this.#muntazir = [];
  }

  stopEventSubscription(): void {
    this.#hawadith = [];
    for (const muntazir of this.#muntazir) {
      muntazir(this.#hadathWaqt());
    }
    this.#muntazir = [];
  }

  nasharHadath(naw: string, properties: Record<string, unknown>): void {
    const hadath: HadathThrum = { type: naw, properties, timestamp: new Date() };
    const muntazir = this.#muntazir.shift();
    if (muntazir) muntazir(hadath);
    else this.#hawadith.push(hadath);
  }

  async replyToQuestion(_sessionId: string, questionId: string, answers: Array<{ questionIndex: number; selected: string[]; custom?: string }>): Promise<boolean> {
    return this.#nahla.emit(Chi.releasePermit, { callId: questionId, ok: true }, { ext: { "iksir-wasila": { answers } } });
  }

  async rejectQuestion(_sessionId: string, questionId: string): Promise<boolean> {
    return this.#nahla.emit(Chi.releasePermit, { callId: questionId, ok: false, error: "question dismissed by wasila" });
  }

  seesAsNahla(): Nahla {
    return this.#nahla;
  }

  async #ajabaNida(t: Tone): Promise<void> {
    const callId = t.callId as string;
    const ism = (t.toolName ?? t.name) as string | undefined;
    const hujaj = (t.args ?? {}) as Record<string, unknown>;
    const rudd = (g: { callId: string; isError?: boolean; output: string }): void => {
      this.#nahla.send({ chi: Chi.toolResult, rid: rid(), ...g } as Tone);
    };
    if (!this.#sijill || !ism) {
      rudd({ callId, isError: true, output: "no sijill alat" });
      return;
    }
    const tanfidh = (async (): Promise<{ ok: boolean; q: string }> => {
      try {
        return { ok: true, q: String(await this.#sijill!.naffidh(ism, hujaj)) };
      } catch (kh) {
        return { ok: false, q: String((kh as Error)?.message ?? kh) };
      }
    })();
    const ajal = new Promise<{ ok: boolean; q: string }>((hal) => {
      const muqqit = setTimeout(() => hal({ ok: false, q: "tool timed out" }), DEFAULT_TIMEOUT_MS);
      if (typeof (muqqit as unknown as { unref?: unknown }).unref === "function") {
        (muqqit as unknown as { unref: () => void }).unref();
      }
    });
    const hasm = await Promise.race([tanfidh, ajal]);
    if (hasm.ok) rudd({ callId, output: hasm.q });
    else rudd({ callId, isError: true, output: hasm.q });
  }

  #jamaDawr(t: Tone): void {    const sid = t.sid as string;
    const dawr = this.#adwar.get(sid);
    const delta = t.delta as string | { text?: string } | undefined;
    const matn = typeof delta === "string" ? delta : (delta?.text ?? "");
    if (matn && dawr) dawr.qataa.push(matn);
    this.nasharHadath("chunk", t as unknown as Record<string, unknown>);
  }

  #ikmalDawr(t: Tone): void {
    const sid = t.sid as string;
    const khata = t.chi === Chi.error;
    const dawr = this.#adwar.get(sid);

    this.#adwarAkhira.set(sid, {
      zaman: Date.now(),
      usage: t.usage,
      khata: khata ? String(t.message ?? "turn aborted") : undefined,
    });

    const jalsa = this.#jalasat.get(sid);
    if (jalsa) {
      jalsa.lastMessageAt = new Date();
      jalsa.status = khata ? "muntasih" : "hayy";
    }

    if (dawr) {
      const matn = dawr.qataa.join("\n");
      if (khata) {
        dawr.hal({ success: false, error: String(t.message ?? "turn aborted") });
      } else if (!matn.trim()) {
        dawr.hal({ success: false, error: "empty response from the cell" });
      } else {
        dawr.hal({ success: true, response: matn });
      }
    }
    this.nasharHadath(khata ? "error" : "finish", t as unknown as Record<string, unknown>);
  }

  #inthaDawr(sid: string, jawab: JawabDawr): void {
    const dawr = this.#adwar.get(sid);
    if (!dawr) return;
    dawr.hal(jawab);
    this.#adwar.delete(sid);
  }

  #zamanDawrAkhira(sid: string): number {
    return this.#adwarAkhira.get(sid)?.zaman ?? this.#jalasat.get(sid)?.lastMessageAt.getTime() ?? 0;
  }

  #adwarAkhiraCount(sid: string): number {
    return this.#adwarAkhira.has(sid) ? 1 : 0;
  }

  #hadathWaqt(): HadathThrum {
    return { type: "loop-stopped", properties: {}, timestamp: new Date() };
  }
}

export class KhataWasila extends Error {}
