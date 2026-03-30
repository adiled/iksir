/**
 * Munadi Configuration
 *
 * Loads and tahaqqaqs configuration from JSON file and environment variables.
 * Schema: iksir.schema.json
 */

import { join } from "jsr:@std/path";
import { exists } from "jsr:@std/fs";
import type { TasmimIksir } from "./types.ts";
import { logger } from "./logging/logger.ts";
import { DEFAULT_OPENCODE_SERVER, DEFAULT_NTFY_SERVER } from "./constants.ts";
const DEFAULT_POLL_INTERVAL_MS = 300000;
const DEFAULT_PR_POLL_INTERVAL_MS = 60000;

const CONFIG_FILENAME = "iksir.json";

function getConfigDir(): string {
  const envDir = Deno.env.get("MUNADI_CONFIG_DIR");
  if (envDir) return envDir;

  const home = Deno.env.get("HOME") ?? Deno.env.get("USERPROFILE") ?? "/root";

  if (Deno.build.os === "darwin") {
    return join(home, ".config", "iksir");
  } else if (Deno.build.os === "windows") {
    return join(home, "AppData", "Local", "iksir");
  }
  return join(home, ".config", "iksir");
}

function resolveEnvVars(value: string): string {
  return value.replace(/\$\{([^}]+)\}/g, (_, key) => {
    return Deno.env.get(key) ?? "";
  });
}

function resolveEnvVarsDeep(obj: unknown): unknown {
  if (typeof obj === "string") {
    return resolveEnvVars(obj);
  }
  if (Array.isArray(obj)) {
    return obj.map(resolveEnvVarsDeep);
  }
  if (obj !== null && typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = resolveEnvVarsDeep(value);
    }
    return result;
  }
  return obj;
}

function getDefaultConfig(): TasmimIksir {
  return {
    polling: {
      defaultIntervalMs: 5 * 60 * 1000,
      prPollIntervalMs: 60 * 1000,
    },
    quietHours: {
      enabled: true,
      start: "22:00",
      end: "07:00",
      timezone: "UTC",
      blockersPassthrough: true,
      maintenanceWindowMinutes: 60,
    },
    notifications: {
      ntfy: {
        enabled: false,
        topic: "iksir",
        server: DEFAULT_NTFY_SERVER,
      },
      telegram: {
        enabled: false,
        botToken: "",
        chatId: "",
        proxy: "",
      },
    },
    issueTracker: {
      provider: "linear",
      apiKey: "",
      teamId: "",
    },
    github: {
      owner: "",
      repo: "",
      ismKimyawi: "",
    },
    opencode: {
      server: DEFAULT_OPENCODE_SERVER,
    },
    prompts: {},
  };
}

function deepMerge(target: TasmimIksir, source: Partial<TasmimIksir>): TasmimIksir {
  const result = { ...target };

  for (const key of Object.keys(source) as (keyof TasmimIksir)[]) {
    const sourceValue = source[key];
    const targetValue = target[key];

    if (
      sourceValue !== undefined &&
      sourceValue !== null &&
      typeof sourceValue === "object" &&
      !Array.isArray(sourceValue) &&
      targetValue !== undefined &&
      targetValue !== null &&
      typeof targetValue === "object" &&
      !Array.isArray(targetValue)
    ) {
      (result as any)[key] = { ...targetValue, ...sourceValue };
    } else if (sourceValue !== undefined) {
      (result as any)[key] = sourceValue;
    }
  }

  return result;
}

function tahaqqaqConfig(config: TasmimIksir): string[] {
  const errors: string[] = [];

  if (!config.opencode.server) {
    errors.push("opencode.server is required");
  }

  if (config.notifications.telegram.enabled) {
    if (!config.notifications.telegram.botToken) {
      errors.push("telegram.botToken is required when Telegram is enabled");
    }
    if (!config.notifications.telegram.chatId) {
      errors.push("telegram.chatId is required when Telegram is enabled");
    }
  }

  if (config.notifications.ntfy.enabled) {
    if (!config.notifications.ntfy.topic) {
      errors.push("ntfy.topic is required when ntfy is enabled");
    }
  }

  if (config.issueTracker.apiKey && !config.issueTracker.teamId) {
    errors.push("issueTracker.teamId is required when API key is provided");
  }

  if (config.github.owner) {
    if (!config.github.repo) {
      errors.push("github.repo is required when github.owner is set");
    }
    if (!config.github.ismKimyawi) {
      errors.push("github.ismKimyawi is required when github.owner is set");
    }
  }

  return errors;
}

export async function loadConfig(): Promise<TasmimIksir> {
  const configDir = getConfigDir();
  const configPath = join(configDir, CONFIG_FILENAME);

  let config = getDefaultConfig();

  if (await exists(configPath)) {
    try {
      const content = await Deno.readTextFile(configPath);
      const parsed = JSON.parse(content) as Partial<TasmimIksir>;
      const resolved = resolveEnvVarsDeep(parsed) as Partial<TasmimIksir>;
      config = deepMerge(config, resolved);
      await logger.info("config", `Loaded configuration from ${configPath}`);
    } catch (error) {
      await logger.error("config", `Failed to load config from ${configPath}`, {
        error: String(error),
      });
      throw error;
    }
  } else {
    await logger.warn("config", `Config file not found at ${configPath}, using defaults`);
  }

  /** Override with environment variables */
  const envOverrides: Partial<TasmimIksir> = {};

  if (Deno.env.get("MUNADI_OPENCODE_SERVER")) {
    envOverrides.opencode = { server: Deno.env.get("MUNADI_OPENCODE_SERVER")! };
  }
  if (Deno.env.get("LINEAR_API_KEY")) {
    envOverrides.issueTracker = { ...config.issueTracker, apiKey: Deno.env.get("LINEAR_API_KEY")! };
  }
  if (Deno.env.get("TELEGRAM_BOT_TOKEN")) {
    envOverrides.notifications = {
      ...config.notifications,
      telegram: {
        ...config.notifications.telegram,
        botToken: Deno.env.get("TELEGRAM_BOT_TOKEN")!,
        enabled: true,
      },
    };
  }
  if (Deno.env.get("TELEGRAM_CHAT_ID")) {
    envOverrides.notifications = {
      ...config.notifications,
      ...envOverrides.notifications,
      telegram: {
        ...config.notifications.telegram,
        ...envOverrides.notifications?.telegram,
        chatId: Deno.env.get("TELEGRAM_CHAT_ID")!,
      },
    };
  }
  if (Deno.env.get("TELEGRAM_GROUP_ID")) {
    envOverrides.notifications = {
      ...config.notifications,
      ...envOverrides.notifications,
      telegram: {
        ...config.notifications.telegram,
        ...envOverrides.notifications?.telegram,
        groupId: Deno.env.get("TELEGRAM_GROUP_ID")!,
      },
    };
  }
  if (Deno.env.get("TELEGRAM_DISPATCH_TOPIC_ID")) {
    envOverrides.notifications = {
      ...config.notifications,
      ...envOverrides.notifications,
      telegram: {
        ...config.notifications.telegram,
        ...envOverrides.notifications?.telegram,
        dispatchTopicId: parseInt(Deno.env.get("TELEGRAM_DISPATCH_TOPIC_ID")!, 10),
      },
    };
  }
  if (Deno.env.get("TELEGRAM_PROXY")) {
    envOverrides.notifications = {
      ...config.notifications,
      ...envOverrides.notifications,
      telegram: {
        ...config.notifications.telegram,
        ...envOverrides.notifications?.telegram,
        proxy: Deno.env.get("TELEGRAM_PROXY")!,
      },
    };
  }
  if (Deno.env.get("NTFY_TOPIC")) {
    envOverrides.notifications = {
      ...config.notifications,
      ntfy: {
        ...config.notifications.ntfy,
        topic: Deno.env.get("NTFY_TOPIC")!,
        enabled: true,
      },
    };
  }

  config = deepMerge(config, envOverrides);

  const errors = tahaqqaqConfig(config);
  if (errors.length > 0) {
    for (const error of errors) {
      await logger.error("config", `Validation error: ${error}`);
    }
    await logger.warn("config", `Config has ${errors.length} validation errors, some features may not work`);
  }

  return config;
}

export function getConfigPath(): string {
  return join(getConfigDir(), CONFIG_FILENAME);
}
