import { test, assertEquals } from "./ikhtibar.ts";
import { hammalaAlTasmim } from "./config.ts";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import {
  TEST_PROXY_URL
} from "./constants.ts";


const ENV_KEYS = [
  "IKSIR_CONFIG_DIR",
  "HUM_THRUM_SOCK",
  "HUM_SOCKET",
  "LINEAR_API_KEY",
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_CHAT_ID",
  "TELEGRAM_GROUP_ID",
  "TELEGRAM_DISPATCH_TOPIC_ID",
  "TELEGRAM_PROXY",
  "NTFY_TOPIC",
];

async function withTestConfig(
  jsonContent: string | null,
  envOverrides: Record<string, string>,
  fn: (config: Awaited<ReturnType<typeof hammalaAlTasmim>>) => void | Promise<void>,
): Promise<void> {
  const tempDir = mkdtempSync(join(tmpdir(), "iksir-config-test-"));

  /** Save existing env vars */
  const saved: Record<string, string | undefined> = {};
  for (const key of ENV_KEYS) {
    saved[key] = process.env[key];
  }

  try {
    process.env.IKSIR_CONFIG_DIR = tempDir;

    if (jsonContent !== null) {
      writeFileSync(join(tempDir, "iksir.json"), jsonContent);
    }

    for (const [key, value] of Object.entries(envOverrides)) {
      process.env[key] = value;
    }

    const config = await hammalaAlTasmim();
    await fn(config);
  } finally {
    for (const key of ENV_KEYS) {
      if (saved[key] !== undefined) {
        process.env[key] = saved[key]!;
      } else {
        delete process.env[key];
      }
    }
    rmSync(tempDir, { recursive: true, force: true });
  }
}


test("config: defaults when no config file exists", async () => {
  await withTestConfig(null, {}, (config) => {
    assertEquals(config.hum, {});
    assertEquals(config.istiftaa.fajwatZamaniyya, 300000);
    assertEquals(config.istiftaa.fajwatRaqabaRisala, 60000);
    assertEquals(config.saatSukun.mufattah, true);
    assertEquals(config.saatSukun.bidaya, "22:00");
    assertEquals(config.saatSukun.nihaya, "07:00");
    assertEquals(config.saatSukun.mintaqaZamaniyya, "UTC");
    assertEquals(config.saatSukun.daqaiqNafizhaSeyana, 60);
    assertEquals(config.isharat.telegram.mufattah, false);
    assertEquals(config.isharat.ntfy.mufattah, false);
  });
});


test("config: loads values from JSON", async () => {
  const json = JSON.stringify({
    saatSukun: {
      mintaqaZamaniyya: "Asia/Karachi",
      bidaya: "23:00",
      nihaya: "08:00",
    },
    hum: {
      socket: "/tmp/thrum.sock"
    },
  });
  await withTestConfig(json, {}, (config) => {
    assertEquals(config.saatSukun.mintaqaZamaniyya, "Asia/Karachi");
    assertEquals(config.saatSukun.bidaya, "23:00");
    assertEquals(config.hum.socket, "/tmp/thrum.sock");
    assertEquals(config.saatSukun.mufattah, true);
    assertEquals(config.istiftaa.fajwatZamaniyya, 300000);
  });
});


test("config: HUM_THRUM_SOCK env override", async () => {
  await withTestConfig(null, { HUM_THRUM_SOCK: "/tmp/env-thrum.sock" }, (config) => {
    assertEquals(config.hum.socket, "/tmp/env-thrum.sock");
  });
});

test("config: TELEGRAM_BOT_TOKEN enables telegram", async () => {
  await withTestConfig(null, {
    TELEGRAM_BOT_TOKEN: "test-token-123",
    TELEGRAM_CHAT_ID: "12345",
  }, (config) => {
    assertEquals(config.isharat.telegram.mufattah, true);
    assertEquals(config.isharat.telegram.ramzBot, "test-token-123");
    assertEquals(config.isharat.telegram.huwiyyatMuhadatha, "12345");
  });
});

test("config: TELEGRAM_PROXY env override", async () => {
  await withTestConfig(null, {
    TELEGRAM_PROXY: TEST_PROXY_URL
  }, (config) => {
    assertEquals(config.isharat.telegram.proxy, TEST_PROXY_URL);
  });
});

test("config: NTFY_TOPIC enables ntfy", async () => {
  await withTestConfig(null, { NTFY_TOPIC: "my-topic" }, (config) => {
    assertEquals(config.isharat.ntfy.mufattah, true);
    assertEquals(config.isharat.ntfy.topic, "my-topic");
  });
});

test("config: env overrides take precedence over JSON", async () => {
  const json = JSON.stringify({
    hum: { socket: "/tmp/json-thrum.sock" }
  });
  await withTestConfig(json, { HUM_THRUM_SOCK: "/tmp/env-thrum.sock" }, (config) => {
    assertEquals(config.hum.socket, "/tmp/env-thrum.sock");
  });
});


test("config: deep merge preserves nested defaults", async () => {
  const json = JSON.stringify({
    saatSukun: { mintaqaZamaniyya: "Asia/Karachi" },
  });
  await withTestConfig(json, {}, (config) => {
    assertEquals(config.saatSukun.mintaqaZamaniyya, "Asia/Karachi");
    assertEquals(config.saatSukun.mufattah, true);
    assertEquals(config.saatSukun.bidaya, "22:00");
    assertEquals(config.saatSukun.tanaqqulMasdud, true);
  });
});
