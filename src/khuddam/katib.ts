/**
 * Katib (كاتب) — The Scribe
 *
 * One of the sacred Khuddām (خدّام) of Iksīr.
 *
 * Katib's quill is never dry. Every vessel that is lit
 * is inscribed by Katib's hand — its huwiyya, its far, its naw, its hala.
 * When a Murshid awakens, Katib prepares the vessel. When a Murshid sleeps,
 * Katib seals the vessel and records the state in the Sijill.
 *
 * Katib also names the furū (branches) according to the sacred convention:
 *   malhamat:  epic/{huwiyya}-{kunya}
 *   khadma:    {ismMustakhdim}/{huwiyya}
 *   warsha:    sandbox/{kunya}
 *
 * No vessel exists that Katib has not inscribed.
 * No state persists that Katib has not recorded.
 */

import { Wasila } from "../hum/wasila.ts";
import { logger } from "../logging/logger.ts";
import { 
  haddathaAwAdkhalaJalsa,
  jalabaKullJalasat,
  haddathaAwAdkhalaQanat,
  jalabaQararatSijill,
} from "../../db/db.ts";
import type {
  TasmimIksir,
  JalsatMurshid,
  NawMurshid,
  RasulKharij,
} from "../types.ts";

function ismMustakhdimGit(): string {
  return process.env.IKSIR_GIT_USER ?? "dev";
}

export function wallidIsmFar(
  identifier: string,
  type: "epic" | "chore" | "sandbox",
  slug?: string,
  title?: string,
): string {
  if (type === "chore") {
    return `${ismMustakhdimGit()}/${identifier}`;
  }
  if (type === "sandbox") {
    const name = slug ?? identifier.replace(/^SANDBOX-/i, "").toLowerCase();
    return `sandbox/${name}`;
  }
  const effectiveSlug = slug ?? (title
    ? title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 30)
    : "work");
  return `epic/${identifier.toLowerCase()}-${effectiveSlug}`;
}

interface TasmimMudirJalasat {
  tasmim: TasmimIksir;
  amil: Wasila;
  rasul: RasulKharij;
}

export class MudirJalasat {
  #config: TasmimIksir;
  #amil: Wasila;
  #messenger: RasulKharij;

  #murshidSessions: Map<string, JalsatMurshid> = new Map();

  #murshidFaailId: string | null = null;

  #gitMasdud = false;

  constructor(deps: TasmimMudirJalasat) {
    this.#config = deps.tasmim;
    this.#amil = deps.amil;
    this.#messenger = deps.rasul;
  }

  get tasmim(): TasmimIksir {
    return this.#config;
  }

  huwaGitMasdud(): boolean {
    return this.#gitMasdud;
  }

  wadaaQuflGit(value: boolean): void {
    this.#gitMasdud = value;
  }

  async wajadaAwKhalaqa(
    identifier: string,
    title: string,
    type: "epic" | "chore" | "sandbox" = "epic"
  ): Promise<{ session: JalsatMurshid; jadida: boolean; mustarjaa: boolean; faailSabiq: string | null } | null> {
    const faailSabiq = this.#murshidFaailId;

    const mawjuda = this.#murshidSessions.get(identifier);
    if (mawjuda) {
      await logger.akhbar("session-manager", `Resuming tracked murshid session for ${identifier}`, {
        sessionId: mawjuda.id,
      });
      this.#murshidFaailId = identifier;
      await this.takkadMinQanat(mawjuda);
      this.#ushhidaJalsa("istirjaa", mawjuda);
      return { session: mawjuda, jadida: false, mustarjaa: true, faailSabiq };
    }

    await logger.akhbar("session-manager", `Creating new murshid session for ${identifier}`);

    const sessionTitle = `[Murshid] ${identifier}: ${title}`;
    const jalsa = await this.#amil.khalaqaJalsa(identifier, sessionTitle);

    if (!jalsa) {
      await logger.sajjalKhata("session-manager", `Failed to create murshid session for ${identifier}`);
      return null;
    }

    const session: JalsatMurshid = {
      id: jalsa.id,
      huwiyya: identifier,
      unwan: title,
      naw: type,
      far: wallidIsmFar(identifier, type, undefined, title),
      hala: "fail",
      unshiaFi: new Date().toISOString(),
      akhirRisalaFi: new Date().toISOString(),
      channels: {},
    };

    this.#murshidSessions.set(identifier, session);
    this.#murshidFaailId = identifier;

    await this.hafizaHala();

    await this.takkadMinQanat(session);

    await this.#arsalaTasisMurshid(session);

    this.#ushhidaJalsa("khalaqa", session);
    return { session, jadida: true, mustarjaa: false, faailSabiq };
  }

  wajadaMurshidFaail(): JalsatMurshid | null {
    if (!this.#murshidFaailId) return null;
    return this.#murshidSessions.get(this.#murshidFaailId) ?? null;
  }

  jalabMurshid(epicId: string): JalsatMurshid | null {
    return this.#murshidSessions.get(epicId) ?? null;
  }

  wajadaMurshidBiQanat(provider: string, channelId: string): JalsatMurshid | null {
    const identifier = this.#messenger.hallJalsaBilQanat(provider, channelId);
    if (!identifier) return null;
    return this.#murshidSessions.get(identifier) ?? null;
  }

  async takkadMinQanat(session: JalsatMurshid): Promise<void> {
    if (this.#messenger.yamlikQanatMurshid(session.huwiyya)) {
      return;
    }

    const channelId = await this.#messenger.khalaqaQanatMurshid(
      session.huwiyya,
      session.unwan,
    );

    if (channelId) {
      session.channels["telegram"] = channelId;
      await this.hafizaHala();

      await this.#messenger.send(
        { murshid: session.huwiyya },
        `Murshid session started for ${session.huwiyya}.\n\nAll messages for this epic will appear here.`,
      );

      await this.#amil.sendPromptAsync(
        session.id,
        `SYSTEM: Your messaging channel is now active. ` +
        `All pm_reply and pm_notify messages will appear there. ` +
        `Al-Kimyawi is listening. If you have pending status updates or responses, please send them now using pm_reply.`,
      );
    }
  }

  wajadaMurshidFaailId(): string | null {
    return this.#murshidFaailId;
  }

  wadaaMurshidFaail(epicId: string | null): void {
    this.#murshidFaailId = epicId;
  }

  async jaddadaḤalatMurshid(
    epicId: string,
    status: JalsatMurshid["hala"],
    blockedReason?: string
  ): Promise<boolean> {
    const session = this.#murshidSessions.get(epicId);
    if (!session) {
      await logger.haDHHir("session-manager", `Cannot update status - no session for ${epicId}`);
      return false;
    }

    session.hala = status;
    if (blockedReason !== undefined) {
      session.illa = blockedReason;
    } else if (status !== "masdud" && status !== "muntazir") {
      session.illa = undefined;
    }

    await this.hafizaJalsaWahida(epicId);
    await logger.akhbar("session-manager", `Updated ${epicId} status to ${status}`, {
      blockedReason,
    });

    this.#ushhidaJalsa("hala", session);

    return true;
  }

  async arsalaIlaMurshidById(epicId: string, message: string): Promise<boolean> {
    const session = this.#murshidSessions.get(epicId);
    if (!session) {
      await logger.haDHHir("session-manager", `No murshid session for ${epicId}`);
      return false;
    }

    const messageWithReminder = this.maaTadhkirNizam(session, message);
    const success = await this.#amil.sendPromptAsync(session.id, messageWithReminder);
    if (success) {
      session.akhirRisalaFi = new Date().toISOString();
      await this.hafizaJalsaWahida(session.huwiyya);
    }
    return success;
  }

  async arsalaIlaMurshid(message: string): Promise<boolean> {
    const session = this.wajadaMurshidFaail();
    if (!session) {
      await logger.haDHHir("session-manager", "No active murshid session");
      return false;
    }

    const messageWithReminder = this.maaTadhkirNizam(session, message);
    const success = await this.#amil.sendPromptAsync(session.id, messageWithReminder);
    if (success) {
      session.akhirRisalaFi = new Date().toISOString();
      await this.hafizaJalsaWahida(session.huwiyya);
    }
    return success;
  }

  maaTadhkirNizam(session: JalsatMurshid, message: string): string {
    return `${message}

<system-reminder>
Your murshid ID is: ${session.huwiyya}
IMPORTANT: This message is from al-Kimyawi via Telegram. You MUST use pm_reply to respond.
Do NOT output text directly - Al-Kimyawi cannot see your text output, only pm_reply messages.
</system-reminder>`;
  }

  async #arsalaTasisMurshid(session: JalsatMurshid): Promise<void> {
    const prompt = session.naw === "epic" 
      ? `# Epic Assignment

## Epic Details
- **ID**: ${session.huwiyya}
- **Title**: ${session.unwan}

Please use \`pm_read_ticket\` to fetch the full epic details and begin planning.

Awaiting direction from al-Kimyawi...`
      : `# Chore Assignment

## Chore Details
- **ID**: ${session.huwiyya}
- **Title**: ${session.unwan}

This is a standalone task (chore), not an epic. No sub-tickets needed.

Please use \`pm_read_ticket\` to fetch the full details, then implement directly.
When done, use \`mun_istihal\` to create a PR.

Awaiting direction from al-Kimyawi...`;

    await this.#amil.sendPromptAsync(session.id, prompt, {
      agent: "iksir-murshid",
    });
  }

  wajadaMurshidBiHuwiyyatJalsa(sessionId: string): JalsatMurshid | null {
    for (const session of this.#murshidSessions.values()) {
      if (session.id === sessionId) return session;
    }
    return null;
  }

  async aalajaDamj(sessionId: string): Promise<void> {
    const session = this.wajadaMurshidBiHuwiyyatJalsa(sessionId);
    if (!session) return;

    await logger.akhbar("session-manager", `Post-compaction diary reload for ${session.huwiyya}`, {
      sessionId,
    });

    const entries = jalabaQararatSijill({
      huwiyyatMurshid: session.huwiyya,
      limit: 15,
    });

    if (entries.length === 0) {
      await this.#amil.sendPromptAsync(session.id,
        `<system-reminder>
Context compaction occurred. Your conversation history was summarized.
Your murshid ID is: ${session.huwiyya}
Use pm_reply to respond to al-Kimyawi — direct text output is invisible.
Use pm_read_diary to reload full decision history if needed.
</system-reminder>`
      );
      return;
    }

    const diaryBlock = entries
      .map(
        (e) =>
          `[${(e.type as string).toUpperCase()}] ${e.created_at}: ${e.decision}`,
      )
      .join("\n");

    await this.#amil.sendPromptAsync(session.id,
      `<system-reminder>
Context compaction occurred. Key diary decisions for your reference:

${diaryBlock}

Your murshid ID is: ${session.huwiyya}
Use pm_reply to respond to al-Kimyawi — direct text output is invisible.
Call pm_read_diary for full decision history with reasoning.
</system-reminder>`
    );
  }

  wajadaJalasatMurshid(): JalsatMurshid[] {
    return Array.from(this.#murshidSessions.values());
  }

  saddaraHala(): {
    murshidun: JalsatMurshid[];
    murshidFaail: string | null;
  } {
    return {
      murshidun: this.wajadaJalasatMurshid(),
      murshidFaail: this.#murshidFaailId,
    };
  }

  istawradaHala(state: {
    murshidun?: JalsatMurshid[];
    murshidFaail?: string | null;
  }): void {
    if (state.murshidun) {
      for (const session of state.murshidun) {
        this.#murshidSessions.set(session.huwiyya, session);
      }
    }

    if (state.murshidFaail) {
      this.#murshidFaailId = state.murshidFaail;
    }
  }

  #hafizaJalsa(session: JalsatMurshid): void {
    haddathaAwAdkhalaJalsa({
      id: session.id,
      huwiyya: session.huwiyya,
      unwan: session.unwan || (session as unknown as { epicTitle?: string }).epicTitle || "",
      naw: session.naw,
      hala: session.hala,
      far: session.far || "",
      illa: session.illa,
      unshiaFi: session.unshiaFi,
      akhirRisalaFi: session.akhirRisalaFi,
      halaMufassala: {
        nestId: this.#amil.huwiyyatUsh(session.id),
      },
    });

    for (const [provider, channelId] of Object.entries(session.channels)) {
      haddathaAwAdkhalaQanat(session.huwiyya, provider, channelId);
    }
  }

  async hafizaJalsaWahida(epicId: string): Promise<void> {
    const session = this.#murshidSessions.get(epicId);
    if (!session) return;

    try {
      this.#hafizaJalsa(session);
    } catch (error) {
      await logger.sajjalKhata("session-manager", `Failed to save session ${epicId}`, {
        error: String(error),
      });
    }
  }

  #ushhidaJalsa(hadath: string, session: JalsatMurshid): void {
    this.#amil.bassaLog("info", `jalsa ${hadath} ${session.huwiyya}`, {
      naw: "jalsa",
      hadath,
      huwiyya: session.huwiyya,
      unwan: session.unwan,
      nawJalsa: session.naw,
      hala: session.hala,
      far: session.far,
      sidJalsa: session.id,
    });
  }

  async hafizaHala(): Promise<void> {
    try {
      for (const session of this.#murshidSessions.values()) {
        this.#hafizaJalsa(session);
      }

      await logger.akhbar("session-manager", "Saved session state", {
        murshidun: this.#murshidSessions.size,
      });
    } catch (error) {
      await logger.sajjalKhata("session-manager", "Failed to save session state", {
        error: String(error),
      });
    }
  }

  async hammalaHala(): Promise<void> {
    try {
      const dbSessions = jalabaKullJalasat();
      
      if (dbSessions.length === 0) {
        await logger.akhbar("session-manager", "No existing session state found");
        return;
      }

      const murshidunṢalihun: JalsatMurshid[] = [];
      for (const dbSession of dbSessions) {
        const metadata = JSON.parse(dbSession.hala_mufassala || "{}") as {
          nestId?: string;
        };

        const channels = this.#messenger.hammalQanawatLilJalsa(dbSession.huwiyya);

        const session: JalsatMurshid = {
          id: dbSession.id,
          huwiyya: dbSession.huwiyya,
          unwan: dbSession.unwan ?? "",
          naw: dbSession.naw as NawMurshid,
          hala: dbSession.hala as JalsatMurshid["hala"],
          far: dbSession.far ?? "",
          illa: dbSession.illa ?? undefined,
          unshiaFi: dbSession.unshia_fi,
          akhirRisalaFi: dbSession.akhir_risala_fi ?? "",
          channels,
        };

        this.#amil.istaadaJalsa({
          id: session.id,
          projectId: "",
          huwiyyatWasfa: session.huwiyya,
          title: session.unwan,
          status: "sakin",
          createdAt: new Date(session.unshiaFi),
          lastMessageAt: new Date(session.akhirRisalaFi || session.unshiaFi),
        }, metadata.nestId);

        murshidunṢalihun.push(session);
        await logger.akhbar("session-manager", `Restored murshid session for ${session.huwiyya}`, {
          resumable: Boolean(metadata.nestId),
        });
      }

      this.istawradaHala({
        murshidun: murshidunṢalihun,
      });

      const activeSession = murshidunṢalihun.find(s => s.hala === "fail");
      if (activeSession) {
        this.#murshidFaailId = activeSession.huwiyya;
      }

      await logger.akhbar("session-manager", "Loaded session state from SQLite", {
        murshidun: murshidunṢalihun.length,
        active: this.#murshidFaailId,
      });

      for (const session of murshidunṢalihun) {
        await this.takkadMinQanat(session);
      }
    } catch (error) {
      await logger.sajjalKhata("session-manager", "Failed to load session state", {
        error: String(error),
      });
    }
  }
}

export function istadaaKatib(deps: TasmimMudirJalasat): MudirJalasat {
  return new MudirJalasat(deps);
}
