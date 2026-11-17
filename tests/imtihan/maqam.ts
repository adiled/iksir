/**
 * Al-Maqām — the standing-place of the examination.
 *
 * Stands up a private humd under a temporary home, teaches it the wahm
 * nurse and iksir, starts both, and hands the examiner iksir's own pipe
 * majlis to speak through, its channels to read, its Sijill to query,
 * and the nurse's account of every prompt and wilt. Everything is torn
 * down at the end; nothing touches the machine's own humd or iksir.
 */

import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const JIDHR = new URL("../../", import.meta.url).pathname;

export interface Maqam {
  qul(kalimat: string): void;
  dispatch(): string;
  qanat(huwiyya: string): string;
  sijill<T>(sql: string, ...hujaj: unknown[]): T[];
  wahm(): string[];
  iksir(): string[];
  intazir(f: () => boolean, muhla?: number, wasf?: string): Promise<void>;
  uqtul(): void;
}

function ibtadaa(amr: string, hujaj: string[], env: NodeJS.ProcessEnv, sutur: string[]): ChildProcess {
  const walad = spawn(amr, hujaj, { env, stdio: ["pipe", "pipe", "pipe"] });
  let baqi = "";
  const iqra = (chunk: Buffer) => {
    baqi += chunk.toString();
    const ajzaa = baqi.split("\n");
    baqi = ajzaa.pop() ?? "";
    sutur.push(...ajzaa);
  };
  walad.stdout?.on("data", iqra);
  walad.stderr?.on("data", iqra);
  return walad;
}

async function hatta(f: () => boolean, muhla: number, wasf: string): Promise<void> {
  const azal = Date.now() + muhla;
  while (!f() && Date.now() < azal) await new Promise((r) => setTimeout(r, 50));
  if (!f()) throw new Error(`waited ${muhla}ms in vain for: ${wasf}`);
}

export async function qumBilMaqam(): Promise<Maqam> {
  const dar = mkdtempSync(join(tmpdir(), "iksir-imtihan-"));
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: dar,
    XDG_STATE_HOME: join(dar, "state"),
    XDG_CONFIG_HOME: join(dar, "config"),
    XDG_DATA_HOME: join(dar, "data"),
    XDG_CACHE_HOME: join(dar, "cache"),
    XDG_RUNTIME_DIR: join(dar, "run"),
    IKSIR_CONFIG_DIR: join(dar, "iksir-config"),
    IKSIR_STATE_DIR: join(dar, "iksir-state"),
  };
  for (const k of ["XDG_STATE_HOME", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_CACHE_HOME", "XDG_RUNTIME_DIR", "IKSIR_CONFIG_DIR", "IKSIR_STATE_DIR"]) mkdirSync(env[k]!, { recursive: true });
  writeFileSync(join(env.IKSIR_CONFIG_DIR!, "iksir.json"), JSON.stringify({
    khabath: { majlis: [], kur: ["github"], sijillat: ["github"] },
    hum: { namudhaj: "wahm" },
    ahdaq: { mustawa: "info" },
  }));
  const iksirHive = join(dar, "hives", "iksir");
  mkdirSync(iksirHive, { recursive: true });
  writeFileSync(join(iksirHive, "Orchfile"), "SERVICE iksir\nRUN /usr/bin/true\n");

  const humdSutur: string[] = [];
  const humd = ibtadaa("humd", [], env, humdSutur);
  const sock = join(env.XDG_STATE_HOME!, "hum", "thrum.sock");
  await hatta(() => existsSync(sock) && humdSutur.some((s) => s.includes("humd.ready")), 15_000, "humd to be ready");

  execFileSync("hum", ["hive", iksirHive, "install"], { env, stdio: "pipe" });
  execFileSync("hum", ["hive", join(JIDHR, "hives", "wahm"), "install"], { env, stdio: "pipe" });

  const wahmSutur: string[] = [];
  const wahm = ibtadaa(process.execPath, [join(JIDHR, "hives", "wahm", "wahm.ts")], { ...env, NODE_PATH: join(JIDHR, "node_modules") }, wahmSutur);
  await hatta(() => wahmSutur.includes("nestled"), 15_000, "the wahm nurse to nestle");

  const iksirSutur: string[] = [];
  const iksir = ibtadaa(process.execPath, [join(JIDHR, "src", "main.ts")], env, iksirSutur);
  await hatta(() => iksirSutur.some((s) => s.includes("Awake")), 30_000, `iksir to wake (last: ${iksirSutur.at(-1) ?? ""})`);

  const rasul = join(env.IKSIR_STATE_DIR!, "rasul");
  const udhn = join(rasul, "udhn");
  await hatta(() => existsSync(udhn), 10_000, "the ear");
  const fam = (ism: string) => { const m = join(rasul, "fam", ism); return existsSync(m) ? readFileSync(m, "utf-8") : ""; };
  const sijillMasar = join(env.IKSIR_STATE_DIR!, "iksir.sqlite");

  return {
    qul(kalimat) {
      execFileSync("sh", ["-c", `printf '%s\\n' ${JSON.stringify(kalimat)} > ${JSON.stringify(udhn)}`]);
    },
    dispatch: () => fam("dispatch"),
    qanat: (huwiyya) => fam(huwiyya),
    sijill<T>(sql: string, ...hujaj: unknown[]): T[] {
      const d = new DatabaseSync(sijillMasar, { readOnly: true });
      try {
        return (d.prepare(sql).all(...(hujaj as never[])) as Array<Record<string, unknown>>).map((saf) => ({ ...saf })) as T[];
      } finally {
        d.close();
      }
    },
    wahm: () => [...wahmSutur],
    iksir: () => [...iksirSutur],
    intazir: (f, muhla = 15_000, wasf = "the condition") => hatta(f, muhla, wasf),
    uqtul() {
      for (const w of [iksir, wahm, humd]) w.kill("SIGTERM");
      setTimeout(() => { for (const w of [iksir, wahm, humd]) if (w.exitCode === null) w.kill("SIGKILL"); rmSync(dar, { recursive: true, force: true }); }, 1500).unref();
    },
  };
}
