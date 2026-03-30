/**
 * Munadi CLI
 *
 * Single entry point for all Munadi operations.
 *
 * Usage:
 *   iksir start              Start all services
 *   iksir start mcp          Start just the MCP service
 *   iksir stop               Stop all services
 *   munadi restart             Restart all services
 *   munadi status              Show service and session status
 *   munadi check               Validate config, type check, run tests
 *   munadi sync                Sync prompts and plugins to agent runtime
 *   munadi config              Print resolved configuration
 *   munadi help                Show this help
 */

import { VERSION } from "./main.ts";
import { loadConfig, getConfigPath } from "./config.ts";
import { runInit } from "./init.ts";
import { baddaaQaidatBayanat, aghlaaqQaidatBayanat, jalabaKullJalasat, jalabaAseilaGhairMujaba } from "../db/db.ts";
import { execCommand } from "./utils/exec.ts";
import { join } from "jsr:@std/path";

const SERVICES = ["munadi-mcp", "munadi-agent", "munadi"] as const;

const HELP = `
munadi v${VERSION} - Autonomous Agent Orchestration

Usage:
  munadi <command> [target] [options]

Setup:
  init               Interactive onboarding wizard

Service management:
  start [target]     Start services (all, mcp, agent, or daemon)
  stop [target]      Stop services
  restart [target]   Restart services
  status             Show service and session status

Maintenance:
  update             Pull latest, sync prompts, restart services
  check              Validate config, type check, run tests
  sync               Sync prompts and plugins to agent runtime
  config             Print resolved configuration
  config --path      Print config file path

Run './install' for first-time setup.
`;


/** Returns ["--user"] for non-root, [] for root. */
function systemctlMode(): string[] {
  return Deno.uid() === 0 ? [] : ["--user"];
}

type ServiceTarget = "all" | "mcp" | "agent" | "daemon";

function resolveTarget(arg?: string): ServiceTarget {
  if (!arg || arg.startsWith("-")) return "all";
  const targets: Record<string, ServiceTarget> = {
    all: "all", mcp: "mcp", agent: "agent", daemon: "daemon",
  };
  return targets[arg] ?? "all";
}

function serviceName(target: ServiceTarget): string[] {
  switch (target) {
    case "mcp": return ["munadi-mcp"];
    case "agent": return ["munadi-agent"];
    case "daemon": return ["munadi"];
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
  const target = resolveTarget(Deno.args[1]);
  const services = serviceName(target);

  /**
   * For start/restart, order matters: mcp → agent → daemon
   * For stop, reverse: daemon → agent → mcp
   */
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
      console.log(`  ${s.identifier} [${s.status}] branch:${s.branch ?? "none"}`);
    }
    if (questions.length > 0) {
      console.log(`\nPending questions: ${questions.length}`);
      for (const q of questions) {
        console.log(`  ${q.id} (${q.session_id})`);
      }
    }
    aghlaaqQaidatBayanat();
  } catch {
    console.log("\nDatabase: not tahyiad");
  }
}


async function cmdCheck(): Promise<void> {
  const repoPath = Deno.env.get("MUNADI_REPO_PATH") ?? ".";
  let failures = 0;

  console.log("Checking config...");
  try {
    const config = await loadConfig();
    console.log(`  \x1b[32m✓\x1b[0m Config loaded from ${getConfigPath()}`);
    if (config.issueTracker.apiKey) console.log("  \x1b[32m✓\x1b[0m Issue tracker API key set");
    else console.log("  \x1b[33m!\x1b[0m Issue tracker API key not set");
    if (config.notifications.telegram.botToken) console.log("  \x1b[32m✓\x1b[0m Telegram bot token set");
    else console.log("  \x1b[33m!\x1b[0m Telegram bot token not set");
  } catch (e) {
    console.log(`  \x1b[31m✗\x1b[0m Config error: ${e}`);
    failures++;
  }

  console.log("\nType checking...");
  const entries = ["src/main.ts", "src/mcp/pm-server.ts", "src/mcp/serve.ts", "src/cli.ts"];
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
  const repoPath = Deno.env.get("MUNADI_REPO_PATH") ?? Deno.cwd();
  const home = Deno.env.get("HOME") ?? ".";
  const agentDir = join(home, ".config", "opencode", "agent");
  const pluginDir = join(home, ".config", "opencode", "plugins");

  await Deno.mkdir(agentDir, { recursive: true });
  await Deno.mkdir(pluginDir, { recursive: true });

  let synced = 0;
  const promptsDir = join(repoPath, "prompts");
  try {
    for await (const entry of Deno.readDir(promptsDir)) {
      if (entry.isFile && entry.name.startsWith("munadi-") && entry.name.endsWith(".md")) {
        await Deno.copyFile(join(promptsDir, entry.name), join(agentDir, entry.name));
        console.log(`  synced prompt: ${entry.name}`);
        synced++;
      }
    }
  } catch {
    console.log("  No prompts directory found");
  }

  const pluginsDir = join(repoPath, "plugins");
  try {
    for await (const entry of Deno.readDir(pluginsDir)) {
      if (entry.isFile && entry.name.endsWith(".ts")) {
        await Deno.copyFile(join(pluginsDir, entry.name), join(pluginDir, entry.name));
        console.log(`  synced plugin: ${entry.name}`);
        synced++;
      }
    }
  } catch {
  }

  console.log(`\nSynced ${synced} file(s).`);
}


async function cmdUpdate(): Promise<void> {
  const repoPath = Deno.env.get("MUNADI_REPO_PATH") ?? Deno.cwd();

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
  const config = await loadConfig();
  if (Deno.args.includes("--path")) {
    console.log(getConfigPath());
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
    console.log(`munadi v${VERSION}`);
    break;
  default:
    console.error(`Unknown command: ${command}`);
    console.log(HELP);
    Deno.exit(1);
}
