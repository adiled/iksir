import { VERSION } from "./main.ts";
import { hammalaAlTasmim, masarMilafAlTasmim } from "./config.ts";
import { runInit } from "./init.ts";
import { baddaaQaidatBayanat, aghlaaqQaidatBayanat, jalabaKullJalasat, jalabaAseilaGhairMujaba } from "../db/db.ts";
import { execCommand } from "./utils/exec.ts";
import { join } from "node:path";
import { mkdirSync, readdirSync, copyFileSync } from "node:fs";

const SERVICES = ["iksir"] as const;

const HELP = `
iksir v${VERSION} - Autonomous Agent Tansiq

Usage:
  iksir <command> [target] [options]

Setup:
  init               Interactive onboarding wizard

Service management:
  start [target]     Start services (all or daemon)
  stop [target]      Stop services
  restart [target]   Restart services
  status             Show service and session status

Maintenance:
  update             Pull latest, sync prompts, restart services
  check              Validate config, run tests
  sync               Sync prompts and plugins to sacred vessels
  config             Print resolved configuration
  config --path      Print config file path

Run './install' for first-time setup.
`;

const argv = process.argv.slice(2);

function systemctlMode(): string[] {
  const uid = typeof process.getuid === "function" ? process.getuid() : 1000;
  return uid === 0 ? [] : ["--user"];
}

type ServiceTarget = "all" | "daemon";

function resolveTarget(arg?: string): ServiceTarget {
  if (!arg || arg.startsWith("-")) return "all";
  const targets: Record<string, ServiceTarget> = {
    all: "all", daemon: "daemon",
  };
  return targets[arg] ?? "all";
}

function serviceName(target: ServiceTarget): string[] {
  switch (target) {
    case "daemon": return ["iksir"];
    case "all": return [...SERVICES];
  }
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
  const target = resolveTarget(argv[1]);
  const services = serviceName(target);

  const ordered = action === "stop" ? [...services].reverse() : services;

  console.log(`${action === "start" ? "Starting" : action === "stop" ? "Stopping" : "Restarting"} ${target === "all" ? "all services" : target}...`);
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
      console.log(`  ${s.huwiyya} [${s.hala}] far:${s.far ?? "none"}`);
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
  const repoPath = process.env.IKSIR_REPO_PATH ?? ".";
  let failures = 0;

  console.log("Checking config...");
  try {
    const config = await hammalaAlTasmim();
    console.log(`  \x1b[32m✓\x1b[0m Config loaded from ${masarMilafAlTasmim()}`);
    if (config.mutabiWasfa.miftahApi) console.log("  \x1b[32m✓\x1b[0m Issue tracker API key set");
    else console.log("  \x1b[33m!\x1b[0m Issue tracker API key not set");
    if (config.isharat.telegram.ramzBot) console.log("  \x1b[32m✓\x1b[0m Telegram bot token set");
    else console.log("  \x1b[33m!\x1b[0m Telegram bot token not set");
  } catch (e) {
    console.log(`  \x1b[31m✗\x1b[0m Config error: ${e}`);
    failures++;
  }

  console.log("\nRunning tests...");
  const testResult = await execCommand("npm", ["test"], { cwd: repoPath });
  if (testResult.success) {
    const lines = testResult.stdout.split("\n");
    const summary = lines.find((l) => l.includes("# pass")) ?? "passed";
    console.log(`  \x1b[32m✓\x1b[0m ${summary.trim()}`);
  } else {
    console.log(`  \x1b[31m✗\x1b[0m Tests failed`);
    failures++;
  }

  console.log(failures === 0 ? "\n\x1b[32mAll checks passed.\x1b[0m" : `\n\x1b[31m${failures} check(s) failed.\x1b[0m`);
  if (failures > 0) process.exit(1);
}


async function cmdSync(): Promise<void> {
  const repoPath = process.env.IKSIR_REPO_PATH ?? process.cwd();
  const home = process.env.HOME ?? ".";
  const vesselsDir = join(home, ".config", "iksir");

  mkdirSync(vesselsDir, { recursive: true });

  let synced = 0;
  const promptsDir = join(repoPath, "prompts");
  try {
    for (const entry of readdirSync(promptsDir, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.startsWith("iksir-") && entry.name.endsWith(".md")) {
        copyFileSync(join(promptsDir, entry.name), join(vesselsDir, entry.name));
        console.log(`  synced prompt: ${entry.name}`);
        synced++;
      }
    }
  } catch {
    console.log("  No prompts directory found");
  }

  const pluginsDir = join(repoPath, "plugins");
  try {
    for (const entry of readdirSync(pluginsDir, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith(".ts")) {
        copyFileSync(join(pluginsDir, entry.name), join(vesselsDir, entry.name));
        console.log(`  synced plugin: ${entry.name}`);
        synced++;
      }
    }
  } catch {
  }

  console.log(`\nSynced ${synced} file(s).`);
}


async function cmdUpdate(): Promise<void> {
  const repoPath = process.env.IKSIR_REPO_PATH ?? process.cwd();

  console.log("Pulling latest...");
  const pull = await execCommand("git", ["pull"], { cwd: repoPath });
  if (!pull.success) {
    console.error(`  git pull failed: ${pull.stderr.trim()}`);
    process.exit(1);
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
  if (argv.includes("--path")) {
    console.log(masarMilafAlTasmim());
    return;
  }
  console.log(JSON.stringify(config, null, 2));
}


const command = argv[0] ?? "help";

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
    process.exit(1);
}
