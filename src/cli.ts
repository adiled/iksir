/**
 * Iksir CLI
 *
 * Single entry point for all Iksir operations.
 *
 * Usage:
 *   iksir start              Start the daemon
 *   iksir stop               Stop the daemon
 *   iksir restart             Restart the daemon
 *   iksir status              Show service and session status
 *   iksir check               Validate config, type check, run tests
 *   iksir sync                Sync the ruqan into the config dir
 *   iksir config              Print resolved configuration
 *   iksir help                Show this help
 */

import { VERSION } from "./main.ts";
import { hammalaAlTasmim, masarMilafAlTasmim } from "./config.ts";
import { runInit } from "./init.ts";
import { baddaaQaidatBayanat, aghlaaqQaidatBayanat, jalabaKullJalasat, jalabaAseilaGhairMujaba } from "../db/db.ts";
import { execCommand } from "./utils/exec.ts";
import { join } from "jsr:@std/path";

/**
 * One service. The nest is al-Kimyawi's to supervise, and the instruments
 * ride the daemon's own process.
 */
const SERVICES = ["iksir"] as const;

const HELP = `
iksir v${VERSION} - Autonomous Agent Tansiq

Usage:
  iksir <command> [target] [options]

Setup:
  init               Interactive onboarding wizard

Service management:
  start              Start the daemon
  stop               Stop the daemon
  restart            Restart the daemon
  status             Show service and session status

Maintenance:
  update             Pull latest, sync ruqan, restart the daemon
  check              Validate config, type check, run tests
  sync               Sync the ruqan into the config dir
  config             Print resolved configuration
  config --path      Print config file path

Run './install' for first-time setup.
`;


/** Returns ["--user"] for non-root, [] for root. */
function systemctlMode(): string[] {
  return Deno.uid() === 0 ? [] : ["--user"];
}

async function systemctl(action: string, targets: string[]): Promise<void> {
  const mode = systemctlMode();
  for (const svc of targets) {
    const result = await execCommand("systemctl", [...mode, action, `${svc}.service`]);
    if (result.success) {
      console.log(`  ${svc}: ${action} ok`);
    } else {
      console.error(`  ${svc}: ${result.stderr.trim()}`);
    }
  }
}

async function cmdServiceAction(action: string): Promise<void> {
  const ordered = [...SERVICES];

  const verb = action === "start" ? "Starting" : action === "stop" ? "Stopping" : "Restarting";
  console.log(`${verb} iksir...`);
  if (action === "restart") {
    await systemctl("restart", ordered);
  } else {
    await systemctl(action, ordered);
  }
}


async function cmdStatus(): Promise<void> {
  const mode = systemctlMode();
  console.log("Services:");
  for (const svc of SERVICES) {
    const result = await execCommand("systemctl", [...mode, "is-active", `${svc}.service`]);
    const state = result.success ? result.stdout.trim() : "not installed";
    const icon = state === "fail" ? "\x1b[32m●\x1b[0m" : "\x1b[31m●\x1b[0m";
    console.log(`  ${icon} ${svc}: ${state}`);
  }

  try {
    await baddaaQaidatBayanat();
    const sessions = jalabaKullJalasat();
    const questions = jalabaAseilaGhairMujaba();
    console.log(`\nSessions: ${sessions.length}`);
    for (const s of sessions) {
      console.log(`  ${s.identifier} [${s.status}] branch:${s.branch ?? "none"}`);
    }
    if (questions.length > 0) {
      console.log(`\nPending questions: ${questions.length}`);
      for (const q of questions) {
        console.log(`  ${q.id} (${q.huwiyyatJalsa})`);
      }
    }
    aghlaaqQaidatBayanat();
  } catch {
    console.log("\nDatabase: not tahyiad");
  }
}


async function cmdCheck(): Promise<void> {
  const repoPath = Deno.env.get("IKSIR_REPO_PATH") ?? ".";
  let failures = 0;

  console.log("Checking config...");
  try {
    const config = await hammalaAlTasmim();
    console.log(`  \x1b[32m✓\x1b[0m Config loaded from ${masarMilafAlTasmim()}`);
    if (config.isharat.telegram.ramzBot) console.log("  \x1b[32m✓\x1b[0m Telegram bot token set");
    else console.log("  \x1b[33m!\x1b[0m Telegram bot token not set");
  } catch (e) {
    console.log(`  \x1b[31m✗\x1b[0m Config error: ${e}`);
    failures++;
  }

  console.log("\nType checking...");
  const entries = ["src/main.ts", "src/alat/alat-al-iksir.ts", "src/cli.ts"];
  for (const entry of entries) {
    const result = await execCommand("deno", ["check", entry], { cwd: repoPath });
    if (result.success) {
      console.log(`  \x1b[32m✓\x1b[0m ${entry}`);
    } else {
      console.log(`  \x1b[31m✗\x1b[0m ${entry}`);
      console.log(`    ${result.stderr.split("\n")[0]}`);
      failures++;
    }
  }

  console.log("\nRunning tests...");
  const testResult = await execCommand("deno", ["test", "--allow-all"], { cwd: repoPath });
  if (testResult.success) {
    const lines = testResult.stderr.split("\n");
    const summary = lines.find((l) => l.includes("passed")) ?? "passed";
    console.log(`  \x1b[32m✓\x1b[0m ${summary.trim()}`);
  } else {
    console.log(`  \x1b[31m✗\x1b[0m Tests failed`);
    failures++;
  }

  console.log(failures === 0 ? "\n\x1b[32mAll checks passed.\x1b[0m" : `\n\x1b[31m${failures} check(s) failed.\x1b[0m`);
  if (failures > 0) Deno.exit(1);
}


async function cmdSync(): Promise<void> {
  const repoPath = Deno.env.get("IKSIR_REPO_PATH") ?? Deno.cwd();
  const home = Deno.env.get("HOME") ?? ".";
  const agentDir = join(home, ".config", "iksir", "prompts");

  await Deno.mkdir(agentDir, { recursive: true });

  let synced = 0;
  const promptsDir = join(repoPath, "prompts");
  try {
    for await (const entry of Deno.readDir(promptsDir)) {
      if (entry.isFile && entry.name.startsWith("iksir-") && entry.name.endsWith(".md")) {
        await Deno.copyFile(join(promptsDir, entry.name), join(agentDir, entry.name));
        console.log(`  synced prompt: ${entry.name}`);
        synced++;
      }
    }
  } catch {
    console.log("  No prompts directory found");
  }

  console.log(`\nSynced ${synced} file(s).`);
}


async function cmdUpdate(): Promise<void> {
  const repoPath = Deno.env.get("IKSIR_REPO_PATH") ?? Deno.cwd();

  console.log("Pulling latest...");
  const pull = await execCommand("git", ["pull"], { cwd: repoPath });
  if (!pull.success) {
    console.error(`  git pull failed: ${pull.stderr.trim()}`);
    Deno.exit(1);
  }
  const summary = pull.stdout.trim();
  console.log(`  ${summary.includes("Already up to date") ? "Already up to date." : summary.split("\n")[0]}`);

  console.log("Syncing prompts...");
  await cmdSync();

  console.log("Restarting services...");
  const mode = systemctlMode();
  await execCommand("systemctl", [...mode, "daemon-reload"]);
  for (const svc of SERVICES) {
    const result = await execCommand("systemctl", [...mode, "restart", `${svc}.service`]);
    if (result.success) {
      console.log(`  ${svc}: restarted`);
    } else {
      console.error(`  ${svc}: ${result.stderr.trim()}`);
    }
  }

  console.log("\nUpdate complete.");
}


async function cmdConfig(): Promise<void> {
  const config = await hammalaAlTasmim();
  if (Deno.args.includes("--path")) {
    console.log(masarMilafAlTasmim());
    return;
  }
  console.log(JSON.stringify(config, null, 2));
}


const command = Deno.args[0] ?? "help";

switch (command) {
  case "init":
    await runInit();
    break;
  case "start":
  case "stop":
  case "restart":
    await cmdServiceAction(command);
    break;
  case "status":
    await cmdStatus();
    break;
  case "update":
    await cmdUpdate();
    break;
  case "check":
    await cmdCheck();
    break;
  case "sync":
    await cmdSync();
    break;
  case "config":
    await cmdConfig();
    break;
  case "help":
  case "--help":
  case "-h":
    console.log(HELP);
    break;
  case "version":
  case "--version":
  case "-v":
    console.log(`iksir v${VERSION}`);
    break;
  default:
    console.error(`Unknown command: ${command}`);
    console.log(HELP);
    Deno.exit(1);
}
