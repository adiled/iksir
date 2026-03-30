import { assertEquals } from "@std/assert";
import { loadConfig } from "./config.ts";
import { join } from "jsr:@std/path";
import { 
  TEST_OPENCODE_URL, 
  TEST_OPENCODE_URL_ALT, 
  DEFAULT_OPENCODE_SERVER as DEFAULT_OPENCODE_URL,
  TEST_PROXY_URL 
} from "./constants.ts";


/** Env vars we might set during tests — saved/istarjaad around each test */
const ENV_KEYS = [
  "MUNADI_CONFIG_DIR",
  "MUNADI_OPENCODE_SERVER",
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
  fn: (config: Awaited<ReturnType<typeof loadConfig>>) => void | Promise<void>,
): Promise<void> {
  const tempDir = await Deno.makeTempDir({ prefix: "munadi-config-test-" });

  /** Save existing env vars */
  const saved: Record<string, string | undefined> = {};
  for (const key of ENV_KEYS) {
    saved[key] = Deno.env.get(key);
  }

  try {
    Deno.env.set("MUNADI_CONFIG_DIR", tempDir);

    if (jsonContent !== null) {
      await Deno.writeTextFile(join(tempDir, "iksir.json"), jsonContent);
    }

    for (const [key, value] of Object.entries(envOverrides)) {
      Deno.env.set(key, value);
    }

    const config = await loadConfig();
    await fn(config);
  } finally {
    for (const key of ENV_KEYS) {
      if (saved[key] !== undefined) {
        Deno.env.set(key, saved[key]!);
      } else {
        Deno.env.delete(key);
      }
    }
    await Deno.remove(tempDir, { recursive: true });
  }
}


Deno.test("config: defaults when no config file exists", async () => {
  await withTestConfig(null, {}, (config) => {
    assertEquals(config.opencode.server, DEFAULT_OPENCODE_URL);
    assertEquals(config.polling.defaultIntervalMs, 300000);
    assertEquals(config.polling.prPollIntervalMs, 60000);
    assertEquals(config.quietHours.enabled, true);
    assertEquals(config.quietHours.start, "22:00");
    assertEquals(config.quietHours.end, "07:00");
    assertEquals(config.quietHours.timezone, "UTC");
    assertEquals(config.quietHours.maintenanceWindowMinutes, 60);
    assertEquals(config.notifications.telegram.enabled, false);
    assertEquals(config.notifications.ntfy.enabled, false);
  });
});


Deno.test("config: loads values from JSON", async () => {
  const json = JSON.stringify({
    quietHours: {
      timezone: "Asia/Karachi",
      start: "23:00",
      end: "08:00",
    },
    opencode: {
      server: TEST_OPENCODE_URL
    },
  });
  await withTestConfig(json, {}, (config) => {
    assertEquals(config.quietHours.timezone, "Asia/Karachi");
    assertEquals(config.quietHours.start, "23:00");
    assertEquals(config.opencode.server, TEST_OPENCODE_URL);
    assertEquals(config.quietHours.enabled, true);
    assertEquals(config.polling.defaultIntervalMs, 300000);
  });
});


Deno.test("config: MUNADI_OPENCODE_SERVER env override", async () => {
  await withTestConfig(null, { MUNADI_OPENCODE_SERVER: TEST_OPENCODE_URL }, (config) => {
    assertEquals(config.opencode.server, TEST_OPENCODE_URL);
  });
});

Deno.test("config: TELEGRAM_BOT_TOKEN enables telegram", async () => {
  await withTestConfig(null, {
    TELEGRAM_BOT_TOKEN: "test-token-123",
    TELEGRAM_CHAT_ID: "12345",
  }, (config) => {
    assertEquals(config.notifications.telegram.enabled, true);
    assertEquals(config.notifications.telegram.botToken, "test-token-123");
    assertEquals(config.notifications.telegram.chatId, "12345");
  });
});

Deno.test("config: TELEGRAM_PROXY env override", async () => {
  await withTestConfig(null, {
    TELEGRAM_PROXY: TEST_PROXY_URL
  }, (config) => {
    assertEquals(config.notifications.telegram.proxy, TEST_PROXY_URL);
  });
});

Deno.test("config: NTFY_TOPIC enables ntfy", async () => {
  await withTestConfig(null, { NTFY_TOPIC: "my-topic" }, (config) => {
    assertEquals(config.notifications.ntfy.enabled, true);
    assertEquals(config.notifications.ntfy.topic, "my-topic");
  });
});

Deno.test("config: env overrides take precedence over JSON", async () => {
  const json = JSON.stringify({
    opencode: { server: TEST_OPENCODE_URL }
  });
  await withTestConfig(json, { MUNADI_OPENCODE_SERVER: TEST_OPENCODE_URL_ALT }, (config) => {
    assertEquals(config.opencode.server, TEST_OPENCODE_URL_ALT);
  });
});


Deno.test("config: deep merge preserves nested defaults", async () => {
  const json = JSON.stringify({
    quietHours: { timezone: "Asia/Karachi" },
  });
  await withTestConfig(json, {}, (config) => {
    assertEquals(config.quietHours.timezone, "Asia/Karachi");
    assertEquals(config.quietHours.enabled, true);
    assertEquals(config.quietHours.start, "22:00");
    assertEquals(config.quietHours.blockersPassthrough, true);
  });
});
