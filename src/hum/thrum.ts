/**
 * Thrum (ثرم) — The Vibration
 *
 * The single thread between Iksir and the nest. One unix socket,
 * newline-delimited JSON, both directions on the same strand.
 *
 * Iksir speaks as a forager bee: it originates the prompt and claims
 * the sid, and humd carries the worker's chunks back along the sigil
 * to whoever asked. The mun_* adawat travel in the hello, and humd
 * routes each nida by name to the hive whose manifest names it.
 *
 * Two laws govern this file, learned from humd's own source:
 *
 *   I.  The manifest is volatile — humd clears every manifest on
 *       restart and prunes on disconnect. So the hello is sent on
 *       *every* connection, not once. A silent reconnection without
 *       it leaves Iksir nestled but unreachable, its adawat
 *       unrouteable.
 *   II. Iksir must never declare itself a worker. humd re-broadcasts
 *       the output tones of any bee whose manifest carries "worker"
 *       onto the sid sigil — and Iksir is the bee that claimed that
 *       sigil. It would hear its own voice returned.
 */

import { join } from "jsr:@std/path";
import { logger } from "../logging/logger.ts";
import { huwiyyatNahla } from "./identity.ts";

/** The protoVersion Iksir targets. Mismatch warns in humd's log, never fatal. */
export const NUSKHAT_THRUM = "0.7.0";

/** The hive name Iksir registers under. */
export const ISM_KHALIYYA = "iksir";

export type Nagham = Record<string, unknown>;
export type MustamiNagham = (nagham: Nagham) => void;

/** One entry of the adawat manifest — the shape humd routes nida by. */
export interface TaarifAda {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

export interface TasmimThrum {
  /** Explicit socket path. Overrides all discovery. */
  masarMiqbas?: string;
  /** The mun_* adawat to advertise in the hello. */
  adawat?: TaarifAda[];
}

/** humd's rendezvous file — written on bind, naming the socket it actually took. */
interface MaalumatTashghil {
  socket?: string;
  thrum_version?: string;
  version?: string;
  pid?: number;
}

function dalilHala(): string {
  const xdg = Deno.env.get("XDG_STATE_HOME");
  return xdg ? join(xdg, "hum") : join(Deno.env.get("HOME") ?? ".", ".local", "state", "hum");
}

function iqraMaalumatTashghil(): MaalumatTashghil | null {
  try {
    return JSON.parse(Deno.readTextFileSync(join(dalilHala(), "runtime.json")));
  } catch {
    return null;
  }
}

/**
 * Where humd listens, in the order a client must ask.
 *
 * Mirrors hum_paths::thrum_sock_resolved. The rendezvous file wins over the
 * default because the default has moved: humd bound under XDG_RUNTIME_DIR
 * through 0.31, and under the state dir from 0.32. A live 0.31 daemon and
 * a fresh 0.32 one disagree, and only runtime.json knows which is listening.
 */
export function masarThrum(sarih?: string): string {
  if (sarih) return sarih;
  const min = Deno.env.get("HUM_THRUM_SOCK") ?? Deno.env.get("HUM_SOCKET");
  if (min) return min;
  const rt = iqraMaalumatTashghil();
  if (rt?.socket) return rt.socket;
  return join(dalilHala(), "thrum.sock");
}

/** The thrum_version humd published when it bound, if it left word. */
export function nuskhatHumd(): string | null {
  return iqraMaalumatTashghil()?.thrum_version ?? null;
}

let addadNagham = 0;

/** Fresh request id. Format is free; the reference clients use base36 pairs. */
export function ridJadid(): string {
  return `${Date.now().toString(36)}-${(addadNagham++).toString(36)}`;
}

export class Thrum {
  #masar: string;
  #adawat: TaarifAda[];
  #hid: string;

  #ittisal: Deno.UnixConn | null = null;
  #mawsul = false;
  #yughliq = false;

  #muntazir: string[] = [];
  #hasabSid = new Map<string, MustamiNagham>();
  #mustamiuunKull: MustamiNagham[] = [];

  #muhawalat = 0;
  #muaqqit: number | undefined;

  constructor(tasmim: TasmimThrum = {}) {
    this.#masar = masarThrum(tasmim.masarMiqbas);
    this.#adawat = tasmim.adawat ?? [];
    this.#hid = huwiyyatNahla(ISM_KHALIYYA, "fbee");
  }

  get mawsul(): boolean {
    return this.#mawsul;
  }

  get huwiyya(): string {
    return this.#hid;
  }

  get masar(): string {
    return this.#masar;
  }

  /**
   * Open the strand. Resolves on the first successful hello; later
   * reconnections are silent and driven by the read loop's exit.
   */
  async ittasil(): Promise<void> {
    this.#yughliq = false;
    await this.#hawil(true);
  }

  async #hawil(awwal: boolean): Promise<void> {
    let conn: Deno.UnixConn;
    try {
      conn = await Deno.connect({ path: this.#masar, transport: "unix" });
    } catch (error) {
      if (awwal) throw error;
      this.#jadwilIadatIttisal();
      return;
    }

    this.#ittisal = conn;
    this.#mawsul = true;
    this.#muhawalat = 0;

    // Law I — the manifest does not survive humd's restart, nor this
    // bee's disconnection. Every connection re-announces.
    this.#ursilKhaam(this.#naghamTaarif());

    for (const satr of this.#muntazir) this.#ursilKhaam(satr);
    this.#muntazir = [];

    await logger.akhbar("thrum", `Nestled at ${this.#masar}`, { hid: this.#hid });

    this.#halqatQiraa(conn);
  }

  /** The hello. Forager only — see Law II. */
  #naghamTaarif(): Nagham {
    return {
      chi: "hello",
      rid: ridJadid(),
      from: ISM_KHALIYYA,
      hid: this.#hid,
      bee: ["forager"],
      hive: ISM_KHALIYYA,
      version: "0.1.0",
      protoVersion: NUSKHAT_THRUM,
      provides: ["session"],
      ...(this.#adawat.length > 0 ? { tools: this.#adawat } : {}),
      chis: [
        "hello",
        "prompt",
        "cancel",
        "cleanup",
        "curate",
        "release-permit",
        "tool-result",
        "chunk",
        "finish",
        "error",
        "session-ready",
        "tool-call",
        "permission-ask",
        "pulse",
        "echo",
      ],
      source: "https://github.com/adiled/iksir",
    };
  }

  async #halqatQiraa(conn: Deno.UnixConn): Promise<void> {
    const muhallil = new TextDecoder();
    let dhakira = "";

    try {
      for await (const qitaa of conn.readable) {
        dhakira += muhallil.decode(qitaa, { stream: true });
        let satr: number;
        while ((satr = dhakira.indexOf("\n")) >= 0) {
          const khat = dhakira.slice(0, satr);
          dhakira = dhakira.slice(satr + 1);
          if (!khat.trim()) continue;
          this.#wazzi(khat);
        }
      }
    } catch {
      // Read failure is a disconnection like any other.
    }

    this.#mawsul = false;
    this.#ittisal = null;
    if (this.#yughliq) return;

    await logger.akhbar("thrum", "Strand parted; reaching again");
    this.#jadwilIadatIttisal();
  }

  #wazzi(khat: string): void {
    let nagham: Nagham;
    try {
      nagham = JSON.parse(khat);
    } catch {
      // humd drops unparseable lines silently; clients should too.
      return;
    }

    const sid = typeof nagham.sid === "string" ? nagham.sid : "";
    const mustami = sid ? this.#hasabSid.get(sid) : undefined;
    if (mustami) mustami(nagham);

    for (const kull of this.#mustamiuunKull) kull(nagham);
  }

  #jadwilIadatIttisal(): void {
    if (this.#muaqqit !== undefined || this.#yughliq) return;
    const takhir = Math.min(30_000, 250 * Math.pow(2, this.#muhawalat));
    this.#muhawalat++;
    this.#muaqqit = setTimeout(() => {
      this.#muaqqit = undefined;
      void this.#hawil(false);
    }, takhir);
  }

  #ursilKhaam(nagham: Nagham | string): void {
    const satr = typeof nagham === "string" ? nagham : JSON.stringify(nagham) + "\n";
    if (this.#mawsul && this.#ittisal) {
      try {
        this.#ittisal.write(new TextEncoder().encode(satr));
        return;
      } catch {
        this.#mawsul = false;
      }
    }
    this.#muntazir.push(satr);
  }

  /** Send a tone. Queued and flushed on reconnect if the strand is parted. */
  ursil(nagham: Nagham): void {
    if (!nagham.rid) nagham.rid = ridJadid();
    this.#ursilKhaam(nagham);
  }

  /** Listen to one sid's tones. */
  alaSid(sid: string, mustami: MustamiNagham): void {
    this.#hasabSid.set(sid, mustami);
  }

  azilSid(sid: string): void {
    this.#hasabSid.delete(sid);
  }

  /** Listen to every tone, sid-bearing or not. Breath and pulse arrive here. */
  alaKull(mustami: MustamiNagham): void {
    this.#mustamiuunKull.push(mustami);
  }

  aghlaq(): void {
    this.#yughliq = true;
    if (this.#muaqqit !== undefined) {
      clearTimeout(this.#muaqqit);
      this.#muaqqit = undefined;
    }
    try {
      this.#ittisal?.close();
    } catch {
      // Already gone.
    }
    this.#ittisal = null;
    this.#mawsul = false;
  }
}
