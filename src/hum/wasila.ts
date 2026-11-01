import { Bee, Chi, PetalKind, PulseKind, Role, humCli, type Tone } from "thrum";
import { readFileSync } from "node:fs";
import { join as joinMasar } from "node:path";
import type { JalsatHum, HadathThrum, HadathThehum, RisalaMurshid, SijillAlat } from "../types.ts";
import { DEFAULT_TIMEOUT_MS } from "../constants.ts";
import { logger } from "../logging/logger.ts";

const ASAS = "iksir";

type JawabDawr = { success: boolean; response?: string; error?: string };

interface DawrTawaqquf {
  qataa: string[];
  hal: (jawab: JawabDawr) => void;
  zaman: number;
}

export type NahlaHum = Pick<Bee, "on" | "onSid" | "offSid" | "onAny" | "onNestled" | "onAstray" | "onAdvisory" | "start" | "send" | "close" | "id">;

export class Wasila {
  #nahla: NahlaHum;
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
  #warsha?: string;
  #ruqan = new Map<string, string>();
  #mutaghayyirat: Record<string, string>;

  constructor(tasmim?: { namudhaj?: string; warsha?: string; mutaghayyirat?: Record<string, string>; sijill?: SijillAlat; nahla?: NahlaHum }) {
    this.#namudhaj = tasmim?.namudhaj;
    this.#warsha = tasmim?.warsha;
    this.#mutaghayyirat = tasmim?.mutaghayyirat ?? {};
    this.#sijill = tasmim?.sijill ?? null;
    this.#nahla = tasmim?.nahla ?? new Bee({
      hive: ASAS,
      as: "wasila",
      role: Role.forager,
      hello: {
        version: "1.0.0",
        builds: true,
        propensity: { statefulness: "convention-stateful", richness: "medium", wire: "iksir/khuddam" },
        chis: ["hello", "breath", "prompt", "cancel", "cleanup", "curate", "unfurl", "wilt", "error", "pulse", "tendril-reach", "tendril-result", "log", "backfill", "backfill-event"],
        source: "https://github.com/adiled/iksir",
      },
    });

    this.#nahla.on(Chi.breath, (t) => {
      this.#muttasil = true;
      this.#wasfThrum = t.protoVersion ?? null;
    });
    this.#nahla.onAstray(() => {
      this.#muttasil = false;
      for (const sid of [...this.#adwar.keys()]) this.#inthaDawr(sid, { success: false, error: "humd went away mid-bloom" });
    });
    this.#nahla.onAdvisory((a) => void logger.haDHHir("wasila", `${a.code}: ${a.message}`));
    this.#nahla.on(Chi.backfillEvent, (t) => {
      const hadath = t.event as HadathThehum;
      for (const fn of this.#mirata) {
        try {
          fn(hadath);
        } catch (err) {
          void logger.sajjalKhata("wasila", "mirror failed", { error: String(err) });
        }
      }
      this.nasharHadath("backfill-event", t as unknown as Record<string, unknown>);
    });
    this.#nahla.onAny((t) => void logger.akhbar("wasila", `stray ${t.chi}`));
  }

  get muttasil(): boolean {
    return this.#muttasil;
  }

  get huwiyya(): string {
    return this.#nahla.id;
  }

  get wasfaThrum(): string | null {
    return this.#wasfThrum;
  }

  #bidaya: Promise<void> | null = null;

  async ittasil(): Promise<void> {
    this.#bidaya ??= this.#nahla.start();
    await this.#bidaya;
    const azal = Date.now() + 5000;
    while (!this.#muttasil && Date.now() < azal) {
      await new Promise((r) => setTimeout(r, 50));
    }
    if (!this.#muttasil) {
      throw new KhataWasila(`humd admitted the bee but never breathed (${humCli()})`);
    }
  }

  qaf(): void {
    void this.#nahla.close();
    this.#muttasil = false;
  }

  async isHealthy(): Promise<boolean> {
    return this.#muttasil;
  }

  async getVersion(): Promise<string | null> {
    return this.#wasfThrum;
  }

  khalaqaSid(): string {
    return `${ASAS}-${Date.now().toString(36)}-${(++this.#asmas).toString(36)}`;
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
    this.#tabaa(jalsa.id);
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
    this.#nahla.send({ chi: Chi.cleanup, sid });
    this.#nahla.offSid(sid);
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
      nass = readFileSync(joinMasar(maskan, `${ism}.md`), "utf-8").replace(/\{\{(\w+)\}\}/g, (_, k) => this.#mutaghayyirat[k] ?? "");
    } catch {
      void logger.haDHHir("wasila", `No ruqya found for ${ism}; prompting without one`);
    }
    this.#ruqan.set(ism, nass);
    return nass || undefined;
  }

  #tabaa(sid: string): void {
    this.#nahla.onSid(sid, (t) => {
      switch (t.chi) {
        case Chi.unfurl:
          return this.#jamaDawr(t);
        case Chi.wilt:
        case Chi.error:
          return this.#ikmalDawr(t);
        case Chi.pulse: {
          if (t.kind === PulseKind.cellReady && t.cell) {
            const jalsa = this.#jalasat.get(sid);
            if (jalsa) jalsa.nestId = t.cell;
          }
          return this.nasharHadath("pulse", t as unknown as Record<string, unknown>);
        }
        case Chi.tendrilReach:
          return void this.#ajabaNida(t);
        default:
          return;
      }
    });
  }

  #hathth(sid: string, prompt: string, options?: { model?: { providerID: string; modelID: string }; agent?: string; system?: string; cwd?: string }): Tone<"prompt"> {
    const jalsa = this.#jalasat.get(sid);
    const namudhaj = options?.model?.modelID ?? this.#namudhaj;
    const nizam = options?.system ?? (options?.agent ? this.#ruqya(options.agent) : undefined);
    const adawat = this.#sijill?.adawat() ?? [];
    const cwd = options?.cwd ?? (this.#warsha ? `hum:///${this.#warsha.replace(/^\/+/, "")}` : undefined);
    return {
      chi: Chi.prompt,
      sid,
      text: prompt,
      ...(namudhaj ? { modelId: namudhaj } : {}),
      ...(nizam ? { systemPrompt: nizam } : {}),
      ...(jalsa?.nestId ? { resume: jalsa.nestId } : {}),
      ...(cwd ? { cwd } : {}),
      ...(adawat.length > 0 ? { tools: adawat } : {}),
    };
  }

  async sendPrompt(
    sid: string,
    prompt: string,
    options?: { model?: { providerID: string; modelID: string }; agent?: string; system?: string; cwd?: string; timeoutMs?: number },
  ): Promise<JawabDawr> {
    const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (!this.#muttasil) {
      return { success: false, error: "thrum is not connected" };
    }
    const muntazar = new Promise<JawabDawr>((hal) => {
      const sabbq = this.#adwar.get(sid);
      sabbq?.hal({ success: false, error: "stale prompt superseded" });
      this.#adwar.set(sid, { qataa: [], hal, zaman: Date.now() });
    });
    const tone = this.#hathth(sid, prompt, options);
    await logger.akhbar("wasila", `hathth ${sid} namudhaj=${tone.modelId ?? "(nest)"}`);
    this.#nahla.send(tone);

    const muntaqi = new Promise<never>((_, raf) => {
      const muqqit = setTimeout(() => raf(new KhataWasila(`prompt timed out after ${timeoutMs}ms`)), timeoutMs);
      muqqit.unref?.();
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
    options?: { model?: { providerID: string; modelID: string }; agent?: string; system?: string; cwd?: string },
  ): Promise<boolean> {
    if (!this.#muttasil) return false;
    this.#nahla.send(this.#hathth(sid, prompt, options));
    await logger.akhbar("wasila", `Sent async prompt to session ${sid}`);
    return true;
  }

  async abortSession(sid: string): Promise<boolean> {
    if (!this.#muttasil) return false;
    this.#nahla.send({ chi: Chi.cancel, sid });
    return true;
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
    this.#tabaa(jalsa.id);
  }

  huwiyyatUsh(sid: string): string | undefined {
    return this.#jalasat.get(sid)?.nestId;
  }

  async jalabRisalaCount(sid: string): Promise<{ total: number; assistant: number; user: number } | null> {
    const jalsa = this.#jalasat.get(sid);
    if (!jalsa) return null;
    const jumla = this.#adwarAkhira.has(sid) ? 1 : 0;
    return { total: jumla, assistant: jumla, user: jumla };
  }

  async getLastAssistantMessage(sid: string): Promise<RisalaMurshid | null> {
    const dawr = this.#adwarAkhira.get(sid);
    if (!dawr) return null;
    return {
      id: sid,
      createdAt: dawr.zaman,
      tokensOutput: (dawr.usage as { output?: number; output_tokens?: number } | undefined)?.output ?? (dawr.usage as { output_tokens?: number } | undefined)?.output_tokens ?? 0,
      cost: 0,
      error: dawr.khata,
    };
  }

  async summarizeSession(sid: string): Promise<boolean> {
    if (!this.#muttasil) return false;
    this.#nahla.send({ chi: Chi.curate, sid });
    await logger.akhbar("wasila", `Curated jalsa ${sid}`);
    this.nasharHadath("session.compacted", { sessionID: sid });
    return true;
  }

  bassaLog(mustawa: string, risala: string, huyul?: Record<string, unknown>): boolean {
    if (!this.#muttasil) return false;
    this.#nahla.send({ chi: Chi.log, level: mustawa, message: risala, ...(huyul ? { fields: huyul } : {}) });
    return true;
  }

  wadaaMirata(fn: (h: HadathThehum) => void): void {
    this.#mirata.push(fn);
  }

  atlubBackfill(author: string, from: number): boolean {
    if (!this.#muttasil) return false;
    this.#nahla.send({ chi: Chi.backfill, author, from });
    return true;
  }

  async mayyaza(prompt: string): Promise<JawabDawr> {
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
    this.stopEventSubscription();
  }

  stopEventSubscription(): void {
    this.#hawadith = [];
    for (const muntazir of this.#muntazir) {
      muntazir({ type: "loop-stopped", properties: {}, timestamp: new Date() });
    }
    this.#muntazir = [];
  }

  nasharHadath(naw: string, properties: Record<string, unknown>): void {
    const hadath: HadathThrum = { type: naw, properties, timestamp: new Date() };
    const muntazir = this.#muntazir.shift();
    if (muntazir) muntazir(hadath);
    else this.#hawadith.push(hadath);
  }

  async #ajabaNida(t: Tone<"tendril-reach">): Promise<void> {
    const rudd = (g: { isError?: boolean; output: string }): void => {
      this.#nahla.send({ chi: Chi.tendrilResult, callId: t.callId, ...(t.sid ? { sid: t.sid } : {}), ...g });
    };
    if (!this.#sijill) {
      rudd({ isError: true, output: "no sijill alat" });
      return;
    }
    const hujaj = (t.args ?? {}) as Record<string, unknown>;
    const tanfidh = (async (): Promise<{ ok: boolean; q: string }> => {
      try {
        return { ok: true, q: String(await this.#sijill!.naffidh(t.name, hujaj)) };
      } catch (kh) {
        return { ok: false, q: String((kh as Error)?.message ?? kh) };
      }
    })();
    const ajal = new Promise<{ ok: boolean; q: string }>((hal) => {
      const muqqit = setTimeout(() => hal({ ok: false, q: "tool timed out" }), DEFAULT_TIMEOUT_MS);
      muqqit.unref?.();
    });
    const hasm = await Promise.race([tanfidh, ajal]);
    rudd(hasm.ok ? { output: hasm.q } : { isError: true, output: hasm.q });
  }

  #jamaDawr(t: Tone<"unfurl">): void {
    const sid = t.sid as string;
    const dawr = this.#adwar.get(sid);
    if (t.kind === PetalKind.text && t.text && !t.closed && dawr) dawr.qataa.push(t.text);
    this.nasharHadath("unfurl", t as unknown as Record<string, unknown>);
  }

  #ikmalDawr(t: Tone<"wilt"> | Tone<"error">): void {
    const sid = t.sid as string;
    const khata = t.chi === Chi.error;
    const dawr = this.#adwar.get(sid);

    this.#adwarAkhira.set(sid, {
      zaman: Date.now(),
      usage: t.nectar,
      khata: khata ? String(t.message ?? "turn aborted") : undefined,
    });

    const jalsa = this.#jalasat.get(sid);
    if (jalsa) {
      jalsa.lastMessageAt = new Date();
      jalsa.status = khata ? "muntasih" : "hayy";
    }

    if (dawr) {
      const matn = dawr.qataa.join("");
      if (khata) {
        dawr.hal({ success: false, error: String(t.message ?? "turn aborted") });
      } else if (!matn.trim()) {
        dawr.hal({ success: false, error: "empty response from the cell" });
      } else {
        dawr.hal({ success: true, response: matn });
      }
    }
    this.nasharHadath(khata ? "error" : "wilt", t as unknown as Record<string, unknown>);
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
}

export class KhataWasila extends Error {}
