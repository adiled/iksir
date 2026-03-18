import { assertEquals } from "@std/assert";
import { hammalaAlTasmim } from "./config.ts";
import { join } from "jsr:@std/path";
import { 
  TEST_OPENCODE_URL, 
  TEST_OPENCODE_URL_ALT, 
  DEFAULT_OPENCODE_SERVER as DEFAULT_OPENCODE_URL,
  TEST_PROXY_URL 
} from "./constants.ts";


/** Env vars we might set during tests — saved/istarjaad around each test */
const ENV_KEYS = [
  "IKSIR_CONFIG_DIR",
  "IKSIR_OPENCODE_SERVER",
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
  const tempDir = await Deno.makeTempDir({ prefix: "iksir-config-test-" });

  /** Save existing env vars */
  const saved: Record<string, string | undefined> = {};
  for (const key of ENV_KEYS) {
    saved[key] = Deno.env.get(key);
  }

  try {
    Deno.env.set("IKSIR_CONFIG_DIR", tempDir);

    if (jsonContent !== null) {
      await Deno.writeTextFile(join(tempDir, "iksir.json"), jsonContent);
    }

    for (const [key, value] of Object.entries(envOverrides)) {
      Deno.env.set(key, value);
    }

    const config = await hammalaAlTasmim();
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


Deno.test("config: loads values from JSON", async () => {
  const json = JSON.stringify({
    saatSukun: {
      mintaqaZamaniyya: "Asia/Karachi",
      bidaya: "23:00",
      nihaya: "08:00",
    },
    opencode: {
      server: TEST_OPENCODE_URL
    },
  });
  await withTestConfig(json, {}, (config) => {
    assertEquals(config.saatSukun.mintaqaZamaniyya, "Asia/Karachi");
    assertEquals(config.saatSukun.bidaya, "23:00");
    assertEquals(config.opencode.server, TEST_OPENCODE_URL);
    assertEquals(config.saatSukun.mufattah, true);
    assertEquals(config.istiftaa.fajwatZamaniyya, 300000);
  });
});


Deno.test("config: IKSIR_OPENCODE_SERVER env override", async () => {
  await withTestConfig(null, { IKSIR_OPENCODE_SERVER: TEST_OPENCODE_URL }, (config) => {
    assertEquals(config.opencode.server, TEST_OPENCODE_URL);
  });
});

Deno.test("config: TELEGRAM_BOT_TOKEN enables telegram", async () => {
  await withTestConfig(null, {
    TELEGRAM_BOT_TOKEN: "test-token-123",
    TELEGRAM_CHAT_ID: "12345",
  }, (config) => {
    assertEquals(config.isharat.telegram.mufattah, true);
    assertEquals(config.isharat.telegram.ramzBot, "test-token-123");
    assertEquals(config.isharat.telegram.huwiyyatMuhadatha, "12345");
  });
});

Deno.test("config: TELEGRAM_PROXY env override", async () => {
  await withTestConfig(null, {
    TELEGRAM_PROXY: TEST_PROXY_URL
  }, (config) => {
    assertEquals(config.isharat.telegram.proxy, TEST_PROXY_URL);
  });
});

Deno.test("config: NTFY_TOPIC enables ntfy", async () => {
  await withTestConfig(null, { NTFY_TOPIC: "my-topic" }, (config) => {
    assertEquals(config.isharat.ntfy.mufattah, true);
    assertEquals(config.isharat.ntfy.topic, "my-topic");
  });
});

Deno.test("config: env overrides take precedence over JSON", async () => {
  const json = JSON.stringify({
    opencode: { server: TEST_OPENCODE_URL }
  });
  await withTestConfig(json, { IKSIR_OPENCODE_SERVER: TEST_OPENCODE_URL_ALT }, (config) => {
    assertEquals(config.opencode.server, TEST_OPENCODE_URL_ALT);
  });
});


Deno.test("config: deep merge preserves nested defaults", async () => {
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
