/**
 * munadi init — Interactive onboarding wizard
 *
 * Walks through each integration step by step, tahaqqaqs credentials
 * live, auto-detects what it can, and writes config files.
 */

import { join } from "jsr:@std/path";
import { exists } from "jsr:@std/fs";
import { execCommand } from "./utils/exec.ts";

// =============================================================================
// Terminal helpers
// =============================================================================

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
  const buf = new Uint8Array(1024);
  Deno.stdout.writeSync(new TextEncoder().encode(`  ${label}${suffix}: `));
  const n = await Deno.stdin.read(buf);
  const input = new TextDecoder().decode(buf.subarray(0, n ?? 0)).trim();
  return input || defaultValue;
}

async function promptSecret(label: string): Promise<string> {
  Deno.stdout.writeSync(new TextEncoder().encode(`  ${label}: `));
  // Deno doesn't have native hidden input, but we can use raw mode
  try {
    Deno.stdin.setRaw(true);
    const chars: number[] = [];
    const buf = new Uint8Array(1);
    while (true) {
      const n = await Deno.stdin.read(buf);
      if (n === null || n === 0) break;
      const c = buf[0];
      if (c === 13 || c === 10) break; // Enter
      if (c === 3) { // Ctrl+C
        Deno.stdin.setRaw(false);
        console.log("");
        Deno.exit(1);
      }
      if (c === 127 || c === 8) { // Backspace
        if (chars.length > 0) {
          chars.pop();
          Deno.stdout.writeSync(new TextEncoder().encode("\b \b"));
        }
        continue;
      }
      chars.push(c);
      Deno.stdout.writeSync(new TextEncoder().encode("*"));
    }
    Deno.stdin.setRaw(false);
    console.log("");
    return new TextDecoder().decode(new Uint8Array(chars));
  } catch {
    // Fallback if setRaw not available (piped input)
    Deno.stdin.setRaw?.(false);
    const buf = new Uint8Array(1024);
    const n = await Deno.stdin.read(buf);
    return new TextDecoder().decode(buf.subarray(0, n ?? 0)).trim();
  }
}

async function confirm(label: string, defaultYes = true): Promise<boolean> {
  const hint = defaultYes ? "Y/n" : "y/N";
  const input = await prompt(`${label} ${dim(`(${hint})`)}`);
  if (!input) return defaultYes;
  return input.toLowerCase().startsWith("y");
}

function pause(msg = "Press Enter to continue...") {
  Deno.stdout.writeSync(new TextEncoder().encode(`  ${dim(msg)}`));
  const buf = new Uint8Array(64);
  Deno.stdin.readSync(buf);
  console.log("");
}

// =============================================================================
// API helpers
// =============================================================================

async function telegramApi(token: string, method: string): Promise<{ ok: boolean; result?: unknown; description?: string }> {
  try {
    const resp = await fetch(`https://api.telegram.org/bot${token}/${method}`);
    return await resp.json();
  } catch {
    return { ok: false, description: "Network error" };
  }
}

async function linearApi(apiKey: string, query: string): Promise<{ data?: unknown; errors?: unknown[] }> {
  try {
    const resp = await fetch("https://api.linear.app/graphql", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": apiKey,
      },
      body: JSON.stringify({ query }),
    });
    return await resp.json();
  } catch {
    return { errors: [{ message: "Network error" }] };
  }
}

// =============================================================================
// Steps
// =============================================================================

interface InitState {
  telegramBotToken: string;
  telegramChatId: string;
  telegramBotName: string;
  issueTrackerApiKey: string;
  issueTrackerTeamId: string;
  issueTrackerTeamName: string;
  githubOwner: string;
  githubRepo: string;
  githubUsername: string;
  opencodeServer: string;
  skippedTelegram: boolean;
  skippedMutabiWasfa: boolean;
  skippedGithub: boolean;
}

const TOTAL_STEPS = 5;

async function stepTelegram(state: InitState): Promise<void> {
  heading(1, TOTAL_STEPS, "Telegram");
  console.log("");
  console.log(`  Munadi talks to you through a Telegram bot you own.`);
  console.log("");

  if (!await confirm("Set up Telegram?")) {
    state.skippedTelegram = true;
    warn("Skipped. You can configure Telegram later in .env");
    return;
  }

  console.log("");
  console.log(`  ${dim("1.")} Open Telegram, message ${bold("@BotFather")}`);
  console.log(`  ${dim("2.")} Send ${bold("/newbot")} and follow the prompts`);
  console.log(`  ${dim("3.")} Copy the token you receive`);
  console.log("");

  // Get and tahaqqaq token
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
    } else {
      fail(`Invalid token: ${me.description ?? "unknown error"}`);
    }
  }

  // Auto-detect chat ID
  console.log("");
  console.log(`  Now send any message to ${bold(`@${state.telegramBotName}`)} on Telegram.`);
  pause("Then press Enter here...");

  console.log(`  ${dim("Detecting your chat ID...")}`);

  // Clear old updates first
  await telegramApi(state.telegramBotToken, "getUpdates?offset=-1");
  // Small delay then fetch
  await new Promise((r) => setTimeout(r, 500));

  const updates = await telegramApi(state.telegramBotToken, "getUpdates?limit=5&timeout=10");
  if (updates.ok && Array.isArray(updates.result) && updates.result.length > 0) {
    // Get the most recent message
    const last = updates.result[updates.result.length - 1] as {
      message?: { chat: { id: number; first_name?: string } };
    };
    if (last.message?.chat?.id) {
      state.telegramChatId = String(last.message.chat.id);
      const name = last.message.chat.first_name ?? "you";
      ok(`Chat ID detected: ${bold(state.telegramChatId)} (${name})`);
      return;
    }
  }

  // Fallback: manual entry
  warn("Could not auto-detect. You may need to send the message and try again,");
  warn("or enter your chat ID manually.");
  console.log("");
  console.log(`  ${dim("Tip: message @userinfobot on Telegram to find your ID")}`);
  console.log("");
  state.telegramChatId = await prompt("Chat ID");
  if (state.telegramChatId) {
    ok(`Chat ID: ${state.telegramChatId}`);
  }
}

async function stepMutabiWasfa(state: InitState): Promise<void> {
  heading(2, TOTAL_STEPS, "Issue Tracker");
  console.log("");
  console.log(`  Munadi creates and manages tickets. Linear is the default provider.`);
  console.log("");

  if (!await confirm("Set up Linear?")) {
    state.skippedMutabiWasfa = true;
    warn("Skipped. You can configure the issue tracker later in .env");
    return;
  }

  console.log("");
  console.log(`  ${dim("1.")} Go to ${bold("linear.app")} > Settings > API`);
  console.log(`  ${dim("2.")} Create a Personal API Key`);
  console.log("");

  while (true) {
    const key = await promptSecret("API key");
    if (!key) {
      if (await confirm("Skip Linear?", false)) {
        state.skippedMutabiWasfa = true;
        return;
      }
      continue;
    }

    // Validate + fetch teams
    const result = await linearApi(key, "{ teams { nodes { id key name } } }");
    if (result.errors || !result.data) {
      fail("Invalid API key or network error");
      continue;
    }

    const data = result.data as { teams: { nodes: { id: string; key: string; name: string }[] } };
    const teams = data.teams.nodes;

    if (teams.length === 0) {
      fail("No teams found in your Linear workspace");
      continue;
    }

    state.issueTrackerApiKey = key;

    if (teams.length === 1) {
      state.issueTrackerTeamId = teams[0].key;
      state.issueTrackerTeamName = teams[0].name;
      ok(`Connected to Linear, team: ${bold(teams[0].name)} (${teams[0].key})`);
    } else {
      ok("Connected to Linear");
      console.log("");
      console.log("  Teams found:");
      for (const t of teams) {
        console.log(`    ${bold(t.key)} — ${t.name}`);
      }
      console.log("");
      state.issueTrackerTeamId = await prompt("Team ID", teams[0].key);
      const match = teams.find((t) => t.key === state.issueTrackerTeamId);
      state.issueTrackerTeamName = match?.name ?? state.issueTrackerTeamId;
    }
    break;
  }
}

async function stepGithub(state: InitState): Promise<void> {
  heading(3, TOTAL_STEPS, "GitHub");
  console.log("");
  console.log(`  Munadi creates PRs and monitors your repository.`);
  console.log("");

  if (!await confirm("Set up GitHub?")) {
    state.skippedGithub = true;
    warn("Skipped. You can configure GitHub later in munadi.json");
    return;
  }

  // Check gh CLI
  const ghCheck = await execCommand("gh", ["auth", "status"]);
  if (!ghCheck.success) {
    warn("gh CLI not authenticated.");
    console.log("");
    console.log(`  ${dim("Run:")} ${bold("gh auth login")}`);
    console.log("");
    pause("Press Enter after authenticating...");
  } else {
    ok("gh CLI authenticated");
  }

  console.log("");
  const ownerRepo = await prompt("Repository (owner/repo)");
  if (ownerRepo.includes("/")) {
    const [owner, repo] = ownerRepo.split("/", 2);
    state.githubOwner = owner;
    state.githubRepo = repo;

    // Validate repo access
    const check = await execCommand("gh", ["repo", "view", ownerRepo, "--json", "name"]);
    if (check.success) {
      ok(`Repository accessible: ${bold(ownerRepo)}`);
    } else {
      warn("Could not verify repository access. Check permissions later.");
    }
  }

  state.githubUsername = await prompt("Your GitHub username");
  if (state.githubUsername) {
    ok(`Username: ${bold(state.githubUsername)}`);
  }
}

async function stepAgent(state: InitState): Promise<void> {
  heading(4, TOTAL_STEPS, "Agent Runtime");
  console.log("");
  console.log(`  Munadi delegates code to an agent runtime (OpenCode).`);
  console.log("");

  state.opencodeServer = await prompt("Server URL", "http://localhost:4096");

  try {
    const resp = await fetch(`${state.opencodeServer}/health`, { signal: AbortSignal.timeout(3000) });
    if (resp.ok) {
      ok("Agent runtime reachable");
      return;
    }
  } catch {
    // not running
  }

  warn("Agent runtime not reachable (it may not be running yet).");
  console.log(`  ${dim("It will be started by")} ${bold("munadi start")}${dim(".")}`);
}

async function stepFinalize(state: InitState): Promise<void> {
  heading(5, TOTAL_STEPS, "Save Configuration");
  console.log("");

  const repoPath = Deno.env.get("MUNADI_REPO_PATH") ?? Deno.cwd();
  const home = Deno.env.get("HOME") ?? ".";
  const configDir = Deno.env.get("MUNADI_CONFIG_DIR") ??
    join(Deno.env.get("XDG_CONFIG_HOME") ?? join(home, ".config"), "munadi");

  const envPath = join(repoPath, ".env");
  const configPath = join(configDir, "munadi.json");

  // Build .env content
  const envLines: string[] = ["# Generated by munadi init", ""];
  if (state.telegramBotToken) {
    envLines.push(`TELEGRAM_BOT_TOKEN=${state.telegramBotToken}`);
    envLines.push(`TELEGRAM_CHAT_ID=${state.telegramChatId}`);
  }
  if (state.issueTrackerApiKey) {
    envLines.push(`LINEAR_API_KEY=${state.issueTrackerApiKey}`);
  }
  envLines.push("");

  // Build munadi.json
  const config: Record<string, unknown> = {
    $schema: "./munadi.schema.json",
  };

  if (state.issueTrackerTeamId) {
    config.issueTracker = { provider: "linear", teamId: state.issueTrackerTeamId };
  }
  if (state.githubOwner) {
    config.github = {
      owner: state.githubOwner,
      repo: state.githubRepo,
      operatorUsername: state.githubUsername,
    };
  }
  if (state.opencodeServer !== "http://localhost:4096") {
    config.opencode = { server: state.opencodeServer };
  }
  if (state.telegramBotToken) {
    config.notifications = {
      telegram: { enabled: true },
    };
  }

  // Write files
  const envContent = envLines.join("\n") + "\n";

  // Check for existing .env — merge if present
  if (await exists(envPath)) {
    const existing = await Deno.readTextFile(envPath);
    if (existing.includes("TELEGRAM_BOT_TOKEN") || existing.includes("LINEAR_API_KEY")) {
      if (!await confirm("  .env already has credentials. Overwrite?", false)) {
        warn(".env preserved. New values not written.");
        console.log(`  ${dim("You can edit manually:")} ${envPath}`);
      } else {
        await Deno.writeTextFile(envPath, envContent);
        ok(`.env written: ${dim(envPath)}`);
      }
    } else {
      // Append to existing
      await Deno.writeTextFile(envPath, existing.trimEnd() + "\n\n" + envContent);
      ok(`.env updated: ${dim(envPath)}`);
    }
  } else {
    await Deno.writeTextFile(envPath, envContent);
    ok(`.env created: ${dim(envPath)}`);
  }

  // Write munadi.json (only if non-trivial config)
  if (Object.keys(config).length > 1) {
    await Deno.mkdir(configDir, { recursive: true });
    await Deno.writeTextFile(configPath, JSON.stringify(config, null, 2) + "\n");
    ok(`Config written: ${dim(configPath)}`);
  }

  // Summary
  console.log("");
  console.log(`  ${DIM}${"─".repeat(50)}${RESET}`);
  console.log("");
  if (state.telegramBotToken) {
    ok(`Telegram: @${state.telegramBotName}`);
  } else if (state.skippedTelegram) {
    warn("Telegram: skipped");
  }
  if (state.issueTrackerApiKey) {
    ok(`Issue tracker: ${state.issueTrackerTeamName} (Linear)`);
  } else if (state.skippedMutabiWasfa) {
    warn("Issue tracker: skipped");
  }
  if (state.githubOwner) {
    ok(`GitHub: ${state.githubOwner}/${state.githubRepo}`);
  } else if (state.skippedGithub) {
    warn("GitHub: skipped");
  }
  ok(`Agent: ${state.opencodeServer}`);

  console.log("");
  console.log(`  ${bold("Ready.")} Run ${cyan("munadi start")} to begin.`);
  console.log("");
}

// =============================================================================
// Main
// =============================================================================

export async function runInit(): Promise<void> {
  console.log("");
  console.log(`  ${BOLD}munadi${RESET} ${dim("— setup")}`);

  const state: InitState = {
    telegramBotToken: "",
    telegramChatId: "",
    telegramBotName: "",
    issueTrackerApiKey: "",
    issueTrackerTeamId: "",
    issueTrackerTeamName: "",
    githubOwner: "",
    githubRepo: "",
    githubUsername: "",
    opencodeServer: "http://localhost:4096",
    skippedTelegram: false,
    skippedMutabiWasfa: false,
    skippedGithub: false,
  };

  await stepTelegram(state);
  await stepMutabiWasfa(state);
  await stepGithub(state);
  await stepAgent(state);
  await stepFinalize(state);
}
