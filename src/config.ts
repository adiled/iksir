/**
 * Iksir Configuration
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

function masarAlTasmim(): string {
  const envDir = Deno.env.get("IKSIR_CONFIG_DIR");
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

function tasmimAsasi(): TasmimIksir {
  return {
    istiftaa: {
      fajwatZamaniyya: DEFAULT_POLL_INTERVAL_MS,
      fajwatRaqabaRisala: DEFAULT_PR_POLL_INTERVAL_MS,
    },
    saatSukun: {
      mufattah: true,
      bidaya: "22:00",
      nihaya: "07:00",
      mintaqaZamaniyya: "UTC",
      tanaqqulMasdud: true,
      daqaiqNafizhaSeyana: 60,
    },
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
    mutabiWasfa: {
      muqaddim: "linear",
      miftahApi: "",
      huwiyyatFareeq: "",
    },
    github: {
      sahib: "",
      makhzan: "",
      ismKimyawi: "",
    },
    opencode: {
      server: DEFAULT_OPENCODE_SERVER,
    },
    hafazat: {},
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

  if (config.mutabiWasfa.miftahApi && !config.mutabiWasfa.huwiyyatFareeq) {
    errors.push("issueTracker.teamId is required when API key is provided");
  }

  if (config.github.sahib) {
    if (!config.github.makhzan) {
      errors.push("github.repo is required when github.owner is set");
    }
    if (!config.github.ismKimyawi) {
      errors.push("github.ismKimyawi is required when github.owner is set");
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
      const content = await Deno.readTextFile(configPath);
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

  /** Override with environment variables */
  const envOverrides: Partial<TasmimIksir> = {};

  if (Deno.env.get("IKSIR_OPENCODE_SERVER")) {
    envOverrides.opencode = { server: Deno.env.get("IKSIR_OPENCODE_SERVER")! };
  }
  if (Deno.env.get("LINEAR_API_KEY")) {
    envOverrides.mutabiWasfa = { ...config.mutabiWasfa, miftahApi: Deno.env.get("LINEAR_API_KEY")! };
  }
  if (Deno.env.get("TELEGRAM_BOT_TOKEN")) {
    envOverrides.isharat = {
      ...config.isharat,
      telegram: {
        ...config.isharat.telegram,
        ramzBot: Deno.env.get("TELEGRAM_BOT_TOKEN")!,
        mufattah: true,
      },
    };
  }
  if (Deno.env.get("TELEGRAM_CHAT_ID")) {
    envOverrides.isharat = {
      ...config.isharat,
      ...envOverrides.isharat,
      telegram: {
        ...config.isharat.telegram,
        ...envOverrides.isharat?.telegram,
        huwiyyatMuhadatha: Deno.env.get("TELEGRAM_CHAT_ID")!,
      },
    };
  }
  if (Deno.env.get("TELEGRAM_GROUP_ID")) {
    envOverrides.isharat = {
      ...config.isharat,
      ...envOverrides.isharat,
      telegram: {
        ...config.isharat.telegram,
        ...envOverrides.isharat?.telegram,
        huwiyyatMajmuua: Deno.env.get("TELEGRAM_GROUP_ID")!,
      },
    };
  }
  if (Deno.env.get("TELEGRAM_DISPATCH_TOPIC_ID")) {
    envOverrides.isharat = {
      ...config.isharat,
      ...envOverrides.isharat,
      telegram: {
        ...config.isharat.telegram,
        ...envOverrides.isharat?.telegram,
        huwiyyatMawduuIrsal: parseInt(Deno.env.get("TELEGRAM_DISPATCH_TOPIC_ID")!, 10),
      },
    };
  }
  if (Deno.env.get("TELEGRAM_PROXY")) {
    envOverrides.isharat = {
      ...config.isharat,
      ...envOverrides.isharat,
      telegram: {
        ...config.isharat.telegram,
        ...envOverrides.isharat?.telegram,
        proxy: Deno.env.get("TELEGRAM_PROXY")!,
      },
    };
  }
  if (Deno.env.get("NTFY_TOPIC")) {
    envOverrides.isharat = {
      ...config.isharat,
      ntfy: {
        ...config.isharat.ntfy,
        topic: Deno.env.get("NTFY_TOPIC")!,
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
