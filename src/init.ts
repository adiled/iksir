/**
 * iksir init — Interactive onboarding wizard
 *
 * Walks through each integration step by step, tahaqqaqs credentials
 * live, auto-detects what it can, and writes config files.
 */

import { join } from "node:path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
const exists = async (path: string): Promise<boolean> => existsSync(path);
import { humCli } from "thrum";
import { createInterface } from "node:readline/promises";

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

async function prompt(label: string, defaultValue = ""): Promise<string> {
  const suffix = defaultValue ? ` ${dim(`[${defaultValue}]`)}` : "";
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question(`  ${label}${suffix}: `)).trim() || defaultValue;
  } finally {
    rl.close();
  }
}

async function promptSecret(label: string): Promise<string> {
  process.stdout.write(`  ${label}: `);
  const raw = process.stdin.isTTY;
  if (raw) process.stdin.setRawMode(true);
  const chars: string[] = [];
  try {
    for await (const chunk of process.stdin) {
      for (const c of chunk.toString()) {
        if (c === "\r" || c === "\n") {
          console.log("");
          return chars.join("");
        }
        if (c === "\u0003") {
          console.log("");
          process.exit(1);
        }
        if (c === "\u007f" || c === "\b") {
          if (chars.length > 0) {
            chars.pop();
            process.stdout.write("\b \b");
          }
          continue;
        }
        chars.push(c);
        process.stdout.write("*");
      }
    }
    return chars.join("");
  } finally {
    if (raw) process.stdin.setRawMode(false);
    process.stdin.pause();
  }
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
  khabath: string;
  namudhaj: string;
  warsha: string;
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
  heading(1, TOTAL_STEPS, "Telegram");
  console.log("");
  console.log(`  Iksir speaks to you through a Telegram bot you own: Dispatch in one`);
  console.log(`  topic of a forum group, and a topic of its own for every murshid.`);
  console.log("");

  if (!await confirm("Set up Telegram?")) {
    state.skippedTelegram = true;
    warn("Skipped. Iksir will have no voice until TELEGRAM_* are set in .env");
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

async function stepWasfat(state: InitState): Promise<void> {
  heading(2, TOTAL_STEPS, "The Register");
  console.log("");
  console.log(`  The waṣfāt live in Sijill al-Waṣfāt, iksir's own register. Your tickets may`);
  console.log(`  also live outside, in a khabath — name it and the khuddam will know where to`);
  console.log(`  look when you say "issue 9": github, linear, or whatever your host CLI or`);
  console.log(`  web2 calls it. Blank means there is none.`);
  console.log("");

  state.khabath = await prompt("Khabath (outer tracker)", "github");
  if (state.khabath) ok(`Khabath: ${bold(state.khabath)}`);
  state.sabiqaWasfa = await prompt("Mark that minted waṣfa names carry", "W");
  ok(`Waṣfāt iksir mints are named ${bold(`${state.sabiqaWasfa}-1`)}, ${state.sabiqaWasfa}-2, …`);
}

async function stepNest(state: InitState): Promise<void> {
  heading(3, TOTAL_STEPS, "The Nest and the Workshop");
  console.log("");
  console.log(`  Iksir runs no models. It nestles at a ${bold("humd")} as five bees and prompts`);
  console.log(`  whatever nurse you have kindled there. The ${bold("bash")} hive lends the murshidūn`);
  console.log(`  their hands in the workshop — the repository they work on.`);
  console.log("");

  state.warsha = await prompt("Workshop (the repository's path)", process.cwd());
  ok(`Workshop: ${bold(state.warsha)}`);
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
  const home = process.env.HOME ?? ".";
  const configDir = process.env.IKSIR_CONFIG_DIR ??
    join(process.env.XDG_CONFIG_HOME ?? join(home, ".config"), "iksir");

  const envPath = join(here, ".env");
  const configPath = join(configDir, "iksir.json");

  const envLines: string[] = ["# Written by iksir init", ""];
  if (state.telegramBotToken) {
    envLines.push(`TELEGRAM_BOT_TOKEN=${state.telegramBotToken}`);
    envLines.push(`TELEGRAM_CHAT_ID=${state.telegramChatId}`);
    if (state.telegramGroupId) envLines.push(`TELEGRAM_GROUP_ID=${state.telegramGroupId}`);
    if (state.telegramDispatchTopicId) envLines.push(`TELEGRAM_DISPATCH_TOPIC_ID=${state.telegramDispatchTopicId}`);
  }
  envLines.push(`IKSIR_REPO_PATH=${state.warsha}`);
  envLines.push("");

  const config: Record<string, unknown> = { $schema: join(here, "iksir.schema.json") };
  const wasfat: Record<string, string> = {};
  if (state.khabath) wasfat.khabath = state.khabath;
  if (state.sabiqaWasfa && state.sabiqaWasfa !== "W") wasfat.sabiqa = state.sabiqaWasfa;
  if (Object.keys(wasfat).length) config.wasfat = wasfat;
  if (state.namudhaj) config.hum = { namudhaj: state.namudhaj };

  const envContent = envLines.join("\n") + "\n";
  if (await exists(envPath) && readFileSync(envPath, "utf-8").includes("TELEGRAM_BOT_TOKEN")) {
    if (await confirm("  .env already has credentials. Overwrite?", false)) {
      writeFileSync(envPath, envContent);
      ok(`.env written: ${dim(envPath)}`);
    } else {
      warn(`.env preserved: ${dim(envPath)}`);
    }
  } else {
    writeFileSync(envPath, envContent);
    ok(`.env written: ${dim(envPath)}`);
  }

  mkdirSync(configDir, { recursive: true });
  writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
  ok(`Config written: ${dim(configPath)}`);

  console.log("");
  console.log(`  ${DIM}${"─".repeat(50)}${RESET}`);
  console.log("");
  console.log(`  ${bold("Ready.")} Hand it to your humd:`);
  console.log("");
  console.log(`      ${cyan(`hum hive ${here} install`)}`);
  console.log("");
  console.log(`  Then speak in the Dispatch topic.`);
  console.log("");
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
    khabath: "",
    namudhaj: "",
    warsha: process.cwd(),
  };

  await stepTelegram(state);
  await stepWasfat(state);
  await stepNest(state);
  await stepFinalize(state);
}
