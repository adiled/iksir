/**
 * Iksir Configuration
 *
 * Loads and tahaqqaqs configuration from JSON file and environment variables.
 * Schema: iksir.schema.json
 */

import { join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
const exists = async (path: string): Promise<boolean> => existsSync(path);
import type { TasmimIksir } from "./types.ts";
import { logger } from "./logging/logger.ts";
import { DEFAULT_NTFY_SERVER } from "./constants.ts";

const CONFIG_FILENAME = "iksir.json";

function masarAlTasmim(): string {
  const envDir = process.env.IKSIR_CONFIG_DIR;
  if (envDir) return envDir;

  const home = process.env.HOME ?? process.env.USERPROFILE ?? "/root";

  if (process.platform === "darwin") {
    return join(home, ".config", "iksir");
  } else if (process.platform === "windows") {
    return join(home, "AppData", "Local", "iksir");
  }
  return join(home, ".config", "iksir");
}

function resolveEnvVars(value: string): string {
  return value.replace(/\$\{([^}]+)\}/g, (_, key) => {
    return process.env[key] ?? "";
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

function tasmimAsasi(): TasmimIksir {
  return {
    isharat: {
      ntfy: {
        mufattah: false,
        topic: "iksir",
        server: DEFAULT_NTFY_SERVER,
      },
      telegram: {
        mufattah: false,
        ramzBot: "",
        huwiyyatMuhadatha: "",
        proxy: "",
      },
    },
    wasfat: {},
    hum: {},
  };
}

function deepMerge(target: TasmimIksir, source: Partial<TasmimIksir>): TasmimIksir {
  return damaja(target as Record<string, unknown>, source as Record<string, unknown>) as unknown as TasmimIksir;
}

function shay(x: unknown): x is Record<string, unknown> {
  return x !== null && typeof x === "object" && !Array.isArray(x);
}

function damaja(asl: Record<string, unknown>, fawq: Record<string, unknown>): Record<string, unknown> {
  const natija = { ...asl };
  for (const [miftah, qima] of Object.entries(fawq)) {
    if (qima === undefined) continue;
    const qadim = asl[miftah];
    natija[miftah] = shay(qima) && shay(qadim) ? damaja(qadim, qima) : qima;
  }
  return natija;
}

function tahaqqaqConfig(config: TasmimIksir): string[] {
  const errors: string[] = [];

  if (config.isharat.telegram.mufattah) {
    if (!config.isharat.telegram.ramzBot) {
      errors.push("telegram.botToken is required when Telegram is enabled");
    }
    if (!config.isharat.telegram.huwiyyatMuhadatha) {
      errors.push("telegram.chatId is required when Telegram is enabled");
    }
  }

  if (config.isharat.ntfy.mufattah) {
    if (!config.isharat.ntfy.topic) {
      errors.push("ntfy.topic is required when ntfy is enabled");
    }
  }

  return errors;
}

export async function hammalaAlTasmim(): Promise<TasmimIksir> {
  const configDir = masarAlTasmim();
  const configPath = join(configDir, CONFIG_FILENAME);

  let config = tasmimAsasi();

  if (await exists(configPath)) {
    try {
      const content = readFileSync(configPath, "utf-8");
      const parsed = JSON.parse(content) as Partial<TasmimIksir>;
      const resolved = resolveEnvVarsDeep(parsed) as Partial<TasmimIksir>;
      config = deepMerge(config, resolved);
      await logger.akhbar("config", `Loaded configuration from ${configPath}`);
    } catch (error) {
      await logger.sajjalKhata("config", `Failed to load config from ${configPath}`, {
        error: String(error),
      });
      throw error;
    }
  } else {
    await logger.haDHHir("config", `Config file not found at ${configPath}, using defaults`);
  }

  const envOverrides: Partial<TasmimIksir> = {};

  if (process.env.IKSIR_HUM_MODEL) {
    envOverrides.hum = { ...config.hum, namudhaj: process.env.IKSIR_HUM_MODEL! };
  }
  if (process.env.TELEGRAM_BOT_TOKEN) {
    envOverrides.isharat = {
      ...config.isharat,
      telegram: {
        ...config.isharat.telegram,
        ramzBot: process.env.TELEGRAM_BOT_TOKEN!,
        mufattah: true,
      },
    };
  }
  if (process.env.TELEGRAM_CHAT_ID) {
    envOverrides.isharat = {
      ...config.isharat,
      ...envOverrides.isharat,
      telegram: {
        ...config.isharat.telegram,
        ...envOverrides.isharat?.telegram,
        huwiyyatMuhadatha: process.env.TELEGRAM_CHAT_ID!,
      },
    };
  }
  if (process.env.TELEGRAM_GROUP_ID) {
    envOverrides.isharat = {
      ...config.isharat,
      ...envOverrides.isharat,
      telegram: {
        ...config.isharat.telegram,
        ...envOverrides.isharat?.telegram,
        huwiyyatMajmuua: process.env.TELEGRAM_GROUP_ID!,
      },
    };
  }
  if (process.env.TELEGRAM_DISPATCH_TOPIC_ID) {
    envOverrides.isharat = {
      ...config.isharat,
      ...envOverrides.isharat,
      telegram: {
        ...config.isharat.telegram,
        ...envOverrides.isharat?.telegram,
        huwiyyatMawduuIrsal: parseInt(process.env.TELEGRAM_DISPATCH_TOPIC_ID!, 10),
      },
    };
  }
  if (process.env.TELEGRAM_PROXY) {
    envOverrides.isharat = {
      ...config.isharat,
      ...envOverrides.isharat,
      telegram: {
        ...config.isharat.telegram,
        ...envOverrides.isharat?.telegram,
        proxy: process.env.TELEGRAM_PROXY!,
      },
    };
  }
  if (process.env.NTFY_TOPIC) {
    envOverrides.isharat = {
      ...config.isharat,
      ntfy: {
        ...config.isharat.ntfy,
        topic: process.env.NTFY_TOPIC!,
        mufattah: true,
      },
    };
  }

  config = deepMerge(config, envOverrides);

  const errors = tahaqqaqConfig(config);
  if (errors.length > 0) {
    for (const error of errors) {
      await logger.sajjalKhata("config", `Validation error: ${error}`);
    }
    await logger.haDHHir("config", `Config has ${errors.length} validation errors, some features may not work`);
  }

  return config;
}

export function masarMilafAlTasmim(): string {
  return join(masarAlTasmim(), CONFIG_FILENAME);
}
