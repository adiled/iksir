/**
 * Amil Hum (عامل هم) — The Nest-Agent
 *
 * Iksir's hands at the nest. Presents the same face the murshidun
 * always knew, but behind it there is no vendor — only the thrum,
 * and whatever hive al-Kimyawi has chosen to kindle.
 *
 * The inversion is total. Where once Iksir asked a foreign runtime
 * which jalasat existed, it now answers that question itself: the
 * sijill was always the truth, and the runtime was only ever
 * repeating it back. Sessions are minted here, held here, and
 * carried across turns by the nestId the worker returns on
 * session-ready — surrendered again as `resume` on the next prompt,
 * so the cell rehydrates its full prior context.
 *
 * The tongue, translated once, here and nowhere else:
 *
 *   khalaqaJalsa      → mint a sid (no wire call; jalasat are ours)
 *   sendPrompt        → chi:"prompt" → chunk* → finish
 *   abortSession      → chi:"cancel"
 *   mahaqaJalsa       → chi:"cleanup"
 *   summarizeSession  → chi:"curate"
 *   replyToQuestion   → chi:"release-permit"
 *   question.asked    ← chi:"permission-ask"
 *
 * No chi crosses out of this file. The khuddām speak only Arabic.
 */

import { join as joinMasar } from "jsr:@std/path";
import { logger } from "../logging/logger.ts";
import { type Nagham, nuskhatHumd, ridJadid, type TaarifAda, Thrum } from "./thrum.ts";
import type { HadathHum, JalsatHum, TasmimIksir } from "../types.ts";

/** How long a blocking prompt waits before it is abandoned. */
const MUHLAT_IFTIRADIYYA_MS = 30_000;

/** What Iksir remembers of a jalsa the runtime no longer remembers for it. */
interface HalatJalsa {
  id: string;
  huwiyyatWasfa: string;
  title: string;
  createdAt: Date;
  lastMessageAt: Date;
  /** The worker's own session handle, returned on session-ready. */
  nestId?: string;
  /** True between prompt and finish. */
  fail: boolean;
  adadRisalat: number;
  adadRisalatMusaid: number;
  akhirRadd?: string;
  akhirDawra?: DawraMusaid;
}

/**
 * The last turn a murshid took. Raqib reads this to tell a thinking
 * vessel from an 'aliq one: a dawra begun, no tokens flowing, never
 * closed, and five minutes gone.
 */
interface DawraMusaid {
  id: string;
  createdAt: number;
  completedAt?: number;
  tokensOutput: number;
  cost: number;
  error?: string;
}

/** A nida the nest has routed to us, awaiting a natija. */
export interface NidaWarid {
  sid: string;
  callId: string;
  name: string;
  args: Record<string, unknown>;
}

export type MustamiNida = (nida: NidaWarid) => void;

export class AmilHum {
  #thrum: Thrum;
  #jalasat = new Map<string, HalatJalsa>();
  #ahdath: HadathHum[] = [];
  #muntazirAhdath: Array<(h: HadathHum) => void> = [];
  #mustamiuunNida: MustamiNida[] = [];
  #jalsatMumayyiz: string | null = null;
  #namudhaj?: string;
  #ruqan = new Map<string, string>();

  constructor(tasmim: TasmimIksir, adawat: TaarifAda[] = []) {
    this.#namudhaj = tasmim.hum?.namudhaj;
    this.#thrum = new Thrum({
      masarMiqbas: tasmim.hum?.miqbas,
      adawat,
    });
    this.#thrum.alaKull((nagham) => this.#istaqbil(nagham));
  }

  /** Open the strand. Must be awaited before any prompt is sent. */
  async ittasil(): Promise<void> {
    await this.#thrum.ittasil();
  }

  get huwiyya(): string {
    return this.#thrum.huwiyya;
  }

  // ── Hala ────────────────────────────────────────────────────────

  isHealthy(): Promise<boolean> {
    return Promise.resolve(this.#thrum.mawsul);
  }

  getVersion(): Promise<string | null> {
    return Promise.resolve(nuskhatHumd());
  }

  // ── Jalasat ─────────────────────────────────────────────────────

  /**
   * Mint a jalsa. No tone is sent — the sid belongs to the originator,
   * and humd learns of it the moment the first prompt carries it.
   */
  async khalaqaJalsa(huwiyyatWasfa: string, title: string): Promise<JalsatHum | null> {
    const id = `iksir-${huwiyyatWasfa}-${ridJadid()}`;
    const alan = new Date();

    this.#jalasat.set(id, {
      id,
      huwiyyatWasfa,
      title,
      createdAt: alan,
      lastMessageAt: alan,
      fail: false,
      adadRisalat: 0,
      adadRisalatMusaid: 0,
    });

    await logger.akhbar("hum", `Minted jalsa ${id} for ${huwiyyatWasfa}`);
    return this.#zahir(id);
  }

  jalabJalsa(sessionId: string): Promise<JalsatHum | null> {
    return Promise.resolve(this.#zahir(sessionId));
  }

  listSessions(): Promise<JalsatHum[]> {
    const kull = [...this.#jalasat.keys()]
      .map((id) => this.#zahir(id))
      .filter((j): j is JalsatHum => j !== null);
    return Promise.resolve(kull);
  }

  jalabJalsaStatuses(): Promise<Record<string, string>> {
    const natija: Record<string, string> = {};
    for (const [id, h] of this.#jalasat) natija[id] = h.fail ? "fail" : "sakin";
    return Promise.resolve(natija);
  }

  /**
   * Restore a jalsa Iksir minted in an earlier life. The sijill outlives
   * the process; this memory does not, so katib rehydrates it on boot.
   */
  istaadaJalsa(jalsa: JalsatHum, nestId?: string): void {
    if (this.#jalasat.has(jalsa.id)) return;
    this.#jalasat.set(jalsa.id, {
      id: jalsa.id,
      huwiyyatWasfa: jalsa.huwiyyatWasfa,
      title: jalsa.title,
      createdAt: jalsa.createdAt,
      lastMessageAt: jalsa.lastMessageAt,
      nestId,
      fail: false,
      adadRisalat: 0,
      adadRisalatMusaid: 0,
    });
  }

  /** The worker's own handle for a jalsa, if it has reported one yet. */
  huwiyyatUsh(sessionId: string): string | undefined {
    return this.#jalasat.get(sessionId)?.nestId;
  }

  #zahir(id: string): JalsatHum | null {
    const h = this.#jalasat.get(id);
    if (!h) return null;
    return {
      id: h.id,
      projectId: "",
      huwiyyatWasfa: h.huwiyyatWasfa,
      title: h.title,
      status: h.fail ? "fail" : "sakin",
      createdAt: h.createdAt,
      lastMessageAt: h.lastMessageAt,
    };
  }

  // ── Hathth ──────────────────────────────────────────────────────

  /**
   * The ruqya a murshid is summoned under.
   *
   * OpenCode kept these as "agents" in its own config dir and attached them
   * by name. Nothing does that now, so Iksir carries its own incantations:
   * the ruqya is read from the prompts/ archive and sent as systemPrompt.
   * Read once, then held — a murshid's identity does not change mid-work.
   */
  #ruqya(ism: string): string | undefined {
    const mahfuz = this.#ruqan.get(ism);
    if (mahfuz !== undefined) return mahfuz || undefined;

    const makhzan = Deno.env.get("IKSIR_REPO_PATH") ?? ".";
    let nass = "";
    try {
      nass = Deno.readTextFileSync(joinMasar(makhzan, "prompts", `${ism}.md`));
    } catch {
      // A missing ruqya is not fatal — the murshid simply arrives unnamed.
      logger.haDHHir("hum", `No ruqya found for ${ism}; prompting without one`);
    }
    this.#ruqan.set(ism, nass);
    return nass || undefined;
  }

  #naghamHathth(
    sessionId: string,
    prompt: string,
    options?: { agent?: string; system?: string },
  ): Nagham {
    const h = this.#jalasat.get(sessionId);
    const rid = ridJadid();
    const system = options?.system ?? (options?.agent ? this.#ruqya(options.agent) : undefined);

    if (h) {
      h.fail = true;
      h.adadRisalat++;
      h.lastMessageAt = new Date();
      h.akhirDawra = { id: rid, createdAt: Date.now(), tokensOutput: 0, cost: 0 };
    }

    return {
      chi: "prompt",
      rid,
      sid: sessionId,
      hive: "iksir",
      content: prompt,
      ...(this.#namudhaj ? { modelId: this.#namudhaj } : {}),
      ...(system ? { systemPrompt: system } : {}),
      // The worker rehydrates its prior context from this handle. Without
      // it every turn starts cold and the murshid forgets its own work.
      ...(h?.nestId ? { resume: h.nestId } : {}),
    };
  }

  /** Send and wait for the turn to close. */
  async sendPrompt(
    sessionId: string,
    prompt: string,
    options?: {
      model?: { providerID: string; modelID: string };
      agent?: string;
      system?: string;
      timeoutMs?: number;
    },
  ): Promise<{ success: boolean; response?: string; error?: string }> {
    const muhla = options?.timeoutMs ?? MUHLAT_IFTIRADIYYA_MS;
    const h = this.#jalasat.get(sessionId);

    return await new Promise((hall) => {
      let nass = "";
      let intaha = false;

      const anhi = (natija: { success: boolean; response?: string; error?: string }) => {
        if (intaha) return;
        intaha = true;
        clearTimeout(muaqqit);
        this.#thrum.azilSid(sessionId);
        if (h) {
          h.fail = false;
          h.lastMessageAt = new Date();
          if (natija.response) {
            h.akhirRadd = natija.response;
            h.adadRisalatMusaid++;
          }
        }
        hall(natija);
      };

      const muaqqit = setTimeout(
        () => anhi({ success: false, error: `Prompt timed out after ${muhla}ms` }),
        muhla,
      );

      this.#thrum.alaSid(sessionId, (nagham) => {
        const chi = nagham.chi;
        if (chi === "chunk" && nagham.chunkType === "text_delta") {
          if (typeof nagham.delta === "string") nass += nagham.delta;
          return;
        }
        if (chi === "finish") {
          anhi({ success: true, response: nass });
          return;
        }
        if (chi === "error") {
          anhi({ success: false, error: String(nagham.message ?? "unknown") });
        }
      });

      this.#thrum.ursil(this.#naghamHathth(sessionId, prompt, options));
    });
  }

  /**
   * Send without waiting. The murshid's ordinary mode — the turn's
   * output arrives as ahdath, not as a return value.
   */
  async sendPromptAsync(
    sessionId: string,
    prompt: string,
    options?: { agent?: string },
  ): Promise<boolean> {
    this.#thrum.ursil(this.#naghamHathth(sessionId, prompt, options));
    await logger.akhbar("hum", `Sent prompt to jalsa ${sessionId}`);
    return true;
  }

  async abortSession(sessionId: string): Promise<boolean> {
    this.#thrum.ursil({ chi: "cancel", rid: ridJadid(), sid: sessionId });
    const h = this.#jalasat.get(sessionId);
    if (h) h.fail = false;
    await logger.akhbar("hum", `Cancelled jalsa ${sessionId}`);
    return true;
  }

  async mahaqaJalsa(sessionId: string): Promise<boolean> {
    this.#thrum.ursil({ chi: "cleanup", rid: ridJadid(), sid: sessionId });
    this.#thrum.azilSid(sessionId);
    this.#jalasat.delete(sessionId);
    await logger.akhbar("hum", `Cleaned jalsa ${sessionId}`);
    return true;
  }

  /**
   * Compact a swollen jalsa. Note what is absent: no provider, no model.
   * The nest compacts with whatever it is already burning.
   */
  async summarizeSession(
    sessionId: string,
    _options?: { providerID?: string; modelID?: string; auto?: boolean },
  ): Promise<boolean> {
    this.#thrum.ursil({ chi: "curate", rid: ridJadid(), sid: sessionId });
    await logger.akhbar("hum", `Curated jalsa ${sessionId}`);
    // No tone announces a completed curation, so the hadath is raised here
    // — katib is owed its notice either way.
    this.#athir({
      type: "session.compacted",
      properties: { sessionID: sessionId },
      timestamp: new Date(),
    });
    return true;
  }

  // ── Tamyiz ──────────────────────────────────────────────────────

  async mayyaza(prompt: string): Promise<{ success: boolean; response?: string; error?: string }> {
    if (!this.#jalsatMumayyiz) {
      const jalsa = await this.khalaqaJalsa("iksir-mumayyiz", "Iksir Tamyiz");
      if (!jalsa) return { success: false, error: "Failed to mint mumayyiz jalsa" };
      this.#jalsatMumayyiz = jalsa.id;
    }
    return await this.sendPrompt(this.#jalsatMumayyiz, prompt);
  }

  // ── Asila ───────────────────────────────────────────────────────

  /**
   * Answer a suspended sual, releasing the permit that parked the cell.
   *
   * NOTE: no hive bundled with hum emits permission-ask today — claude-cli
   * runs with --dangerously-skip-permissions — so the body shape here is
   * inferred from the chi's contract, not observed on a live wire. Verify
   * against the first hive that actually asks.
   */
  async replyToQuestion(
    sessionId: string,
    questionId: string,
    answers: Array<{ questionIndex: number; selected: string[]; custom?: string }>,
  ): Promise<boolean> {
    this.#thrum.ursil({
      chi: "release-permit",
      rid: ridJadid(),
      sid: sessionId,
      callId: questionId,
      granted: true,
      answers: answers.map((a) => (a.custom ? [a.custom] : a.selected)),
    });
    await logger.akhbar("hum", `Released permit ${questionId}`);
    return true;
  }

  async rejectQuestion(sessionId: string, questionId: string): Promise<boolean> {
    this.#thrum.ursil({
      chi: "release-permit",
      rid: ridJadid(),
      sid: sessionId,
      callId: questionId,
      granted: false,
    });
    await logger.akhbar("hum", `Denied permit ${questionId}`);
    return true;
  }

  // ── Risalat ─────────────────────────────────────────────────────

  jalabRisalaCount(sessionId: string): Promise<{ total: number; assistant: number }> {
    const h = this.#jalasat.get(sessionId);
    return Promise.resolve({
      total: h?.adadRisalat ?? 0,
      assistant: h?.adadRisalatMusaid ?? 0,
    });
  }

  /**
   * The last turn taken. Raqib's instrument for spotting al-'Aliq — a
   * dawra opened, no tokens output, never closed, and the minutes piling up.
   */
  getLastAssistantMessage(sessionId: string): Promise<
    {
      id: string;
      createdAt: number;
      completedAt?: number;
      tokensOutput: number;
      cost: number;
      error?: string;
    } | null
  > {
    return Promise.resolve(this.#jalasat.get(sessionId)?.akhirDawra ?? null);
  }

  // ── Nida ────────────────────────────────────────────────────────

  /** Listen for mun_* adawat the nest routes to us. */
  alaNida(mustami: MustamiNida): void {
    this.#mustamiuunNida.push(mustami);
  }

  /** Return a natija, un-parking the cell that waits on it. */
  raddNida(sid: string, callId: string, natija: unknown): void {
    this.#thrum.ursil({ chi: "tool-result", rid: ridJadid(), sid, callId, result: natija });
  }

  // ── Ahdath ──────────────────────────────────────────────────────

  #istaqbil(nagham: Nagham): void {
    const chi = nagham.chi;
    const sid = typeof nagham.sid === "string" ? nagham.sid : "";

    if (chi === "session-ready") {
      const nestId = typeof nagham.nestId === "string" ? nagham.nestId : undefined;
      const h = this.#jalasat.get(sid);
      if (h && nestId) h.nestId = nestId;
      return;
    }

    if (chi === "finish") {
      const h = this.#jalasat.get(sid);
      if (h) {
        h.fail = false;
        h.lastMessageAt = new Date();
        h.adadRisalatMusaid++;
        if (h.akhirDawra) {
          const usage = (nagham.usage as Record<string, number> | undefined) ?? {};
          h.akhirDawra.completedAt = Date.now();
          h.akhirDawra.tokensOutput = usage.output_tokens ?? 0;
        }
      }
      return;
    }

    if (chi === "error") {
      const h = this.#jalasat.get(sid);
      if (h) {
        h.fail = false;
        if (h.akhirDawra) {
          h.akhirDawra.completedAt = Date.now();
          h.akhirDawra.error = String(nagham.message ?? "unknown");
        }
      }
      return;
    }

    if (chi === "tool-call") {
      const nida: NidaWarid = {
        sid,
        callId: String(nagham.callId ?? ""),
        name: String(nagham.name ?? ""),
        args: (nagham.args as Record<string, unknown>) ?? {},
      };
      for (const m of this.#mustamiuunNida) m(nida);
      return;
    }

    if (chi === "permission-ask") {
      this.#athir({
        type: "question.asked",
        properties: {
          id: String(nagham.callId ?? nagham.rid ?? ""),
          sessionID: sid,
          questions: this.#asilaMin(nagham),
          ...(nagham.callId ? { tool: { messageID: "", callID: String(nagham.callId) } } : {}),
        },
        timestamp: new Date(),
      });
    }
  }

  /** Coax a questions array out of whatever shape the asking hive used. */
  #asilaMin(nagham: Nagham): unknown[] {
    if (Array.isArray(nagham.questions)) return nagham.questions;
    const nass = nagham.question ?? nagham.message ?? nagham.name;
    if (typeof nass !== "string") return [];
    return [{
      header: String(nagham.name ?? "permission"),
      question: nass,
      options: [
        { label: "allow", description: "Permit this action" },
        { label: "deny", description: "Refuse this action" },
      ],
    }];
  }

  #athir(hadath: HadathHum): void {
    const muntazir = this.#muntazirAhdath.shift();
    if (muntazir) muntazir(hadath);
    else this.#ahdath.push(hadath);
  }

  /**
   * The stream of ahdath. Never ends on its own — the strand reconnects
   * beneath it, so unlike the old SSE loop there is nothing to resubscribe.
   */
  async *subscribeToEvents(signal?: AbortSignal): AsyncGenerator<HadathHum> {
    while (!signal?.aborted) {
      const jahiz = this.#ahdath.shift();
      if (jahiz) {
        yield jahiz;
        continue;
      }
      const hadath = await new Promise<HadathHum | null>((hall) => {
        const muntazir = (h: HadathHum) => hall(h);
        this.#muntazirAhdath.push(muntazir);
        signal?.addEventListener("abort", () => {
          const i = this.#muntazirAhdath.indexOf(muntazir);
          if (i >= 0) this.#muntazirAhdath.splice(i, 1);
          hall(null);
        }, { once: true });
      });
      if (!hadath) return;
      yield hadath;
    }
  }

  stopEventSubscription(): void {
    for (const m of this.#muntazirAhdath.splice(0)) {
      m({
        type: "iksir.stopped",
        properties: {},
        timestamp: new Date(),
      });
    }
  }

  aghlaq(): void {
    this.#thrum.aghlaq();
  }
}

/**
 * Summon the amil. The strand is not yet open — call ittasil() once the
 * adawat are known, so the hello carries them and humd can route nida home.
 */
export function createAmilHum(tasmim: TasmimIksir, adawat: TaarifAda[] = []): AmilHum {
  return new AmilHum(tasmim, adawat);
}
