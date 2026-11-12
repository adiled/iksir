/**
 * iksir init — Interactive onboarding wizard
 *
 * Walks al-Kimyawī through the majlis (Telegram), the khabath roster, and
 * the nest; proves what it can live; then sets each answer into iksir.json
 * and the secret into asrar. It sets only what it asked — whatever else the
 * files hold stands.
 */

import { humCli } from "thrum";
import { Tasmim } from "./config.ts";
import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";

const DIM = "\x1b[2m";
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const RED = "\x1b[31m";

const ok = (msg: string) => console.log(`  ${GREEN}✓${RESET} ${msg}`);
const warn = (msg: string) => console.log(`  ${YELLOW}!${RESET} ${msg}`);
const fail = (msg: string) => console.log(`  ${RED}✗${RESET} ${msg}`);
const dim = (msg: string) => `${DIM}${msg}${RESET}`;
const bold = (msg: string) => `${BOLD}${msg}${RESET}`;
const cyan = (msg: string) => `${CYAN}${msg}${RESET}`;

function heading(step: number, total: number, title: string) {
  console.log("");
  console.log(`  ${cyan(`${step}/${total}`)}  ${bold(title)}`);
  console.log(`  ${DIM}${"─".repeat(50)}${RESET}`);
}

let qari: ReturnType<typeof createInterface> | null = null;
let maktum = false;
const tabur: string[] = [];
let muntazir: ((satr: string) => void) | null = null;

const sitar = new Writable({
  write(chunk: Buffer, _enc: string, cb: () => void) {
    const nass = chunk.toString();
    process.stdout.write(maktum && !nass.startsWith("\x1b") ? nass.replace(/[^\r\n]/g, "*") : nass);
    cb();
  },
});

function majlis(): ReturnType<typeof createInterface> {
  if (qari) return qari;
  qari = createInterface({ input: process.stdin, output: sitar, terminal: process.stdin.isTTY === true, prompt: "" });
  qari.on("line", (satr) => {
    const m = muntazir;
    muntazir = null;
    if (m) m(satr); else tabur.push(satr);
  });
  qari.on("close", () => {
    qari = null;
    const m = muntazir;
    muntazir = null;
    if (m) m("");
  });
  return qari;
}

export async function isal(nass: string, khiyarat?: { maktum?: boolean }): Promise<string> {
  majlis();
  process.stdout.write(nass);
  maktum = khiyarat?.maktum === true;
  try {
    if (tabur.length) return tabur.shift()!;
    return await new Promise((hal) => { muntazir = hal; });
  } finally {
    maktum = false;
  }
}

export function aghliqMajlis(): void {
  qari?.close();
}

async function prompt(label: string, defaultValue = ""): Promise<string> {
  const suffix = defaultValue ? ` ${dim(`[${defaultValue}]`)}` : "";
  return (await isal(`  ${label}${suffix}: `)).trim() || defaultValue;
}

async function promptSecret(label: string): Promise<string> {
  return (await isal(`  ${label}: `, { maktum: true })).trim();
}

async function confirm(label: string, defaultYes = true): Promise<boolean> {
  const hint = defaultYes ? "Y/n" : "y/N";
  const input = await prompt(`${label} ${dim(`(${hint})`)}`);
  if (!input) return defaultYes;
  return input.toLowerCase().startsWith("y");
}

async function pause(msg = "Press Enter to continue..."): Promise<void> {
  await prompt(dim(msg));
}

async function telegramApi(token: string, method: string): Promise<{ ok: boolean; result?: unknown; description?: string }> {
  try {
    const resp = await fetch(`https://api.telegram.org/bot${token}/${method}`);
    return await resp.json();
  } catch {
    return { ok: false, description: "Network error" };
  }
}

interface InitState {
  telegramBotToken: string;
  telegramBotName: string;
  telegramChatId: string;
  telegramGroupId: string;
  telegramDispatchTopicId: string;
  skippedTelegram: boolean;
  sabiqaWasfa: string;
  kur: string[];
  sijillat: string[];
  namudhaj: string;
}

const TOTAL_STEPS = 4;

type Update = {
  message?: {
    chat: { id: number; type: string; title?: string; first_name?: string; is_forum?: boolean };
    message_thread_id?: number;
    is_topic_message?: boolean;
  };
};

async function akhirTahdith(token: string, yaqbal: (m: NonNullable<Update["message"]>) => boolean): Promise<NonNullable<Update["message"]> | null> {
  const updates = await telegramApi(token, "getUpdates?limit=20&timeout=10");
  if (!updates.ok || !Array.isArray(updates.result)) return null;
  const m = (updates.result as Update[]).map((u) => u.message).filter((m): m is NonNullable<Update["message"]> => !!m && yaqbal(m));
  return m.at(-1) ?? null;
}

async function stepTelegram(state: InitState): Promise<void> {
  heading(1, TOTAL_STEPS, "The Majlis — Telegram");
  console.log("");
  console.log(`  Iksir speaks to you through a Telegram bot you own: Dispatch in one`);
  console.log(`  topic of a forum group, and a topic of its own for every murshid.`);
  console.log("");

  if (!await confirm("Set up Telegram?")) {
    state.skippedTelegram = true;
    warn(`Skipped. Iksir has no voice until: iksir secret set telegram.ramz; iksir config set khabath.majlis telegram`);
    return;
  }

  console.log("");
  console.log(`  ${dim("1.")} Open Telegram, message ${bold("@BotFather")}`);
  console.log(`  ${dim("2.")} Send ${bold("/newbot")} and follow the prompts`);
  console.log(`  ${dim("3.")} Copy the token you receive`);
  console.log("");

  while (true) {
    const token = await promptSecret("Bot token");
    if (!token) {
      if (await confirm("Skip Telegram?", false)) {
        state.skippedTelegram = true;
        return;
      }
      continue;
    }
    const me = await telegramApi(token, "getMe");
    if (me.ok && me.result) {
      const bot = me.result as { username: string; first_name: string };
      state.telegramBotToken = token;
      state.telegramBotName = bot.username;
      ok(`Connected to ${bold(`@${bot.username}`)} (${bot.first_name})`);
      break;
    }
    fail(`Invalid token: ${me.description ?? "unknown error"}`);
  }

  console.log("");
  console.log(`  Send any message to ${bold(`@${state.telegramBotName}`)} directly, so it knows you.`);
  await pause("Then press Enter here...");
  const dm = await akhirTahdith(state.telegramBotToken, (m) => m.chat.type === "private");
  if (dm) {
    state.telegramChatId = String(dm.chat.id);
    ok(`Chat ID: ${bold(state.telegramChatId)} (${dm.chat.first_name ?? "you"})`);
  } else {
    warn("Not seen yet. Message @userinfobot on Telegram for your ID, or try again later.");
    state.telegramChatId = await prompt("Chat ID");
  }

  console.log("");
  console.log(`  Now the workshop's hall:`);
  console.log(`  ${dim("1.")} Create a group, turn on ${bold("Topics")} in its settings`);
  console.log(`  ${dim("2.")} Add ${bold(`@${state.telegramBotName}`)} as an ${bold("admin")} (it must manage topics)`);
  console.log(`  ${dim("3.")} Create a topic named ${bold("Dispatch")} and send a message in it`);
  await pause("Then press Enter here...");
  const hall = await akhirTahdith(state.telegramBotToken, (m) => m.chat.type === "supergroup" && m.message_thread_id !== undefined);
  if (hall) {
    state.telegramGroupId = String(hall.chat.id);
    state.telegramDispatchTopicId = String(hall.message_thread_id);
    ok(`Group: ${bold(state.telegramGroupId)} (${hall.chat.title ?? "the hall"}), Dispatch topic: ${bold(state.telegramDispatchTopicId)}`);
  } else {
    warn("No topic message seen. Without a hall, iksir speaks only in your direct chat.");
    state.telegramGroupId = await prompt("Group ID (blank to skip)");
    if (state.telegramGroupId) state.telegramDispatchTopicId = await prompt("Dispatch topic ID");
  }
}

function qaima(nass: string): string[] {
  return nass.split(",").map((s) => s.trim()).filter(Boolean);
}

async function stepKhabath(state: InitState): Promise<void> {
  heading(2, TOTAL_STEPS, "The Roster — Khabath");
  console.log("");
  console.log(`  The waṣfāt live in Sijill al-Waṣfāt, iksir's own register. Everything outside`);
  console.log(`  is khabath, named by role, as your host CLI or web2 calls it; several, joined`);
  console.log(`  by commas. Every waṣfa draws its own from these.`);
  console.log("");

  state.kur = qaima(await prompt("Kūr — the forge where jawhar is decanted", "github"));
  if (state.kur.length) ok(`Kūr: ${bold(state.kur.join(", "))}`);
  state.sijillat = qaima(await prompt("Sijillāt — outer trackers work is filed in (github, linear)", "github"));
  if (state.sijillat.length) ok(`Sijillāt: ${bold(state.sijillat.join(", "))}`);
  state.sabiqaWasfa = await prompt("Mark that minted waṣfa names carry", "W");
  ok(`Waṣfāt iksir mints are named ${bold(`${state.sabiqaWasfa}-1`)}, ${state.sabiqaWasfa}-2, …`);
}

async function stepNest(state: InitState): Promise<void> {
  heading(3, TOTAL_STEPS, "The Nest");
  console.log("");
  console.log(`  Iksir runs no models. It nestles at a ${bold("humd")} as five bees and prompts`);
  console.log(`  whatever nurse you have kindled there. The ${bold("bash")} hive lends the murshidūn`);
  console.log(`  their hands.`);
  console.log("");

  state.namudhaj = await prompt("Model to name on each prompt (blank = let the nest decide)", "");

  const miqbas = humCli();
  if (await nabduSukhulThrum(miqbas)) ok(`hum at ${miqbas}`);
  else {
    warn(`No hum at ${miqbas}`);
    console.log(`  ${dim("Install hum, then:")} ${bold("hum hive bash install")} ${dim("and a nurse of your choosing")}`);
  }
}

async function nabduSukhulThrum(hum: string): Promise<boolean> {
  const { accessSync, constants } = await import("node:fs");
  try {
    accessSync(hum, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function stepFinalize(state: InitState): Promise<void> {
  heading(4, TOTAL_STEPS, "Save");
  console.log("");

  const here = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
  const tasmim = new Tasmim();

  if (state.telegramBotToken) {
    tasmim.dhabbitSirr("telegram.ramz", state.telegramBotToken);
    tasmim.dhabbit("khabath.majlis", ["telegram"]);
    tasmim.dhabbit("khabath.telegram.muhadatha", state.telegramChatId);
    if (state.telegramGroupId) tasmim.dhabbit("khabath.telegram.majmuua", state.telegramGroupId);
    if (state.telegramDispatchTopicId) tasmim.dhabbit("khabath.telegram.mawduuIrsal", Number(state.telegramDispatchTopicId));
    ok(`Secret kept (0600): ${dim("telegram.ramz")}`);
  }
  tasmim.dhabbit("khabath.kur", state.kur);
  tasmim.dhabbit("khabath.sijillat", state.sijillat);
  if (state.sabiqaWasfa && state.sabiqaWasfa !== "W") tasmim.dhabbit("wasfat.sabiqa", state.sabiqaWasfa);
  if (state.namudhaj) tasmim.dhabbit("hum.namudhaj", state.namudhaj);
  ok(`Config set: ${dim(tasmim.masar)} ${dim("— only what was asked; the rest stands")}`);

  console.log("");
  console.log(`  ${DIM}${"─".repeat(50)}${RESET}`);
  console.log("");
  console.log(`  ${bold("Ready.")} Hand it to your humd:`);
  console.log("");
  console.log(`      ${cyan(`hum hive ${here} install`)}`);
  console.log("");
  console.log(`  Then speak in the Dispatch topic. Change anything later with`);
  console.log(`  ${cyan("iksir config set")} or ${cyan("iksir secret set")} — the daemon reads it on its next act.`);
  console.log("");
  aghliqMajlis();
}

export async function runInit(): Promise<void> {
  console.log("");
  console.log(`  ${BOLD}iksir${RESET} ${dim("— setup")}`);

  const state: InitState = {
    telegramBotToken: "",
    telegramBotName: "",
    telegramChatId: "",
    telegramGroupId: "",
    telegramDispatchTopicId: "",
    skippedTelegram: false,
    sabiqaWasfa: "W",
    kur: [],
    sijillat: [],
    namudhaj: "",
  };

  await stepTelegram(state);
  await stepKhabath(state);
  await stepNest(state);
  await stepFinalize(state);
}
