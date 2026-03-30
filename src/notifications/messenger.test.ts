/**
 * Tests for src/notifications/messenger.ts
 *
 * Tests TelegramMessenger (MessengerOutbound implementation) with:
 * - Mock TelegramClient (injected via constructor)
 * - Real temp DB (for channel persistence)
 *
 * Key behaviors tested:
 * - Channel routing: dispatch, operator, orchestrator (with/without topic)
 * - Channel creation, persistence, and cache behavior
 * - Reverse lookup via resolveSessionByChannel
 */

import { assertEquals } from "@std/assert";
import { withTestDb, mockTelegramClient } from "../test-helpers.ts";
import { TelegramMessenger } from "./messenger.ts";
import { upsertChannel } from "../../db/db.ts";

// =============================================================================
// send()
// =============================================================================

Deno.test("send: dispatch channel -> sendToDispatch", async () => {
  await withTestDb(async () => {
    const tc = mockTelegramClient();
    const m = new TelegramMessenger(tc as never);

    await m.send("dispatch", "hello dispatch");

    assertEquals(tc._calls.sendToDispatch.length, 1);
    assertEquals(tc._calls.sendToDispatch[0].text, "hello dispatch");
    assertEquals(tc._calls.sendMessage.length, 0);
  });
});

Deno.test("send: operator channel -> sendMessage", async () => {
  await withTestDb(async () => {
    const tc = mockTelegramClient();
    const m = new TelegramMessenger(tc as never);

    await m.send("operator", "hello operator");

    assertEquals(tc._calls.sendMessage.length, 1);
    assertEquals(tc._calls.sendMessage[0].text, "hello operator");
    assertEquals(tc._calls.sendToDispatch.length, 0);
  });
});

Deno.test("send: orchestrator with known topic -> sendToOrchestratorTopic", async () => {
  await withTestDb(async () => {
    const tc = mockTelegramClient();
    const m = new TelegramMessenger(tc as never);

    // Pre-populate DB with a channel
    upsertChannel("TEAM-123", "telegram", "999");

    await m.send({ orchestrator: "TEAM-123" }, "hello orchestrator");

    assertEquals(tc._calls.sendToOrchestratorTopic.length, 1);
    assertEquals(tc._calls.sendToOrchestratorTopic[0].topicId, 999);
    assertEquals(tc._calls.sendToOrchestratorTopic[0].text, "hello orchestrator");
  });
});

Deno.test("send: orchestrator with no topic -> fallback to dispatch with prefix", async () => {
  await withTestDb(async () => {
    const tc = mockTelegramClient();
    const m = new TelegramMessenger(tc as never);

    await m.send({ orchestrator: "TEAM-999" }, "no topic message");

    assertEquals(tc._calls.sendToDispatch.length, 1);
    assertEquals(tc._calls.sendToDispatch[0].text, "[TEAM-999] no topic message");
  });
});

Deno.test("send: disabled messenger -> no calls", async () => {
  await withTestDb(async () => {
    const tc = mockTelegramClient({ isEnabled: false });
    const m = new TelegramMessenger(tc as never);

    await m.send("dispatch", "should not send");
    await m.send("operator", "should not send");
    await m.send({ orchestrator: "TEAM-1" }, "should not send");

    assertEquals(tc._calls.sendToDispatch.length, 0);
    assertEquals(tc._calls.sendMessage.length, 0);
    assertEquals(tc._calls.sendToOrchestratorTopic.length, 0);
  });
});

// =============================================================================
// sendFormatted()
// =============================================================================

Deno.test("sendFormatted: dispatch -> sendToDispatch with Markdown", async () => {
  await withTestDb(async () => {
    const tc = mockTelegramClient();
    const m = new TelegramMessenger(tc as never);

    await m.sendFormatted("dispatch", "**bold** text");

    assertEquals(tc._calls.sendToDispatch.length, 1);
    assertEquals(tc._calls.sendToDispatch[0].options?.parseMode, "Markdown");
  });
});

Deno.test("sendFormatted: operator -> sendMessage with Markdown", async () => {
  await withTestDb(async () => {
    const tc = mockTelegramClient();
    const m = new TelegramMessenger(tc as never);

    await m.sendFormatted("operator", "**bold** text");

    assertEquals(tc._calls.sendMessage.length, 1);
    assertEquals(tc._calls.sendMessage[0].options?.parseMode, "Markdown");
  });
});

Deno.test("sendFormatted: orchestrator with topic -> Markdown", async () => {
  await withTestDb(async () => {
    const tc = mockTelegramClient();
    const m = new TelegramMessenger(tc as never);

    upsertChannel("TEAM-100", "telegram", "555");

    await m.sendFormatted({ orchestrator: "TEAM-100" }, "**bold**");

    assertEquals(tc._calls.sendToOrchestratorTopic.length, 1);
    assertEquals(tc._calls.sendToOrchestratorTopic[0].options?.parseMode, "Markdown");
  });
});

Deno.test("sendFormatted: orchestrator fallback -> dispatch with prefix + Markdown", async () => {
  await withTestDb(async () => {
    const tc = mockTelegramClient();
    const m = new TelegramMessenger(tc as never);

    await m.sendFormatted({ orchestrator: "TEAM-999" }, "**bold**");

    assertEquals(tc._calls.sendToDispatch.length, 1);
    assertEquals(tc._calls.sendToDispatch[0].text, "[TEAM-999] **bold**");
    assertEquals(tc._calls.sendToDispatch[0].options?.parseMode, "Markdown");
  });
});

// =============================================================================
// isEnabled()
// =============================================================================

Deno.test("isEnabled: delegates to TelegramClient", async () => {
  const tcEnabled = mockTelegramClient({ isEnabled: true });
  const mEnabled = new TelegramMessenger(tcEnabled as never);
  assertEquals(mEnabled.isEnabled(), true);

  const tcDisabled = mockTelegramClient({ isEnabled: false });
  const mDisabled = new TelegramMessenger(tcDisabled as never);
  assertEquals(mDisabled.isEnabled(), false);
});

// =============================================================================
// createOrchestratorChannel()
// =============================================================================

Deno.test("createOrchestratorChannel: creates topic, persists to DB, returns channelId", async () => {
  await withTestDb(async () => {
    const tc = mockTelegramClient({
      createForumTopic: async () => ({ message_thread_id: 77, name: "test" }),
    });
    const m = new TelegramMessenger(tc as never);

    const result = await m.createOrchestratorChannel("TEAM-200", "Implement feature");

    assertEquals(result, "77");
    assertEquals(tc._calls.createForumTopic.length, 1);
    assertEquals(tc._calls.createForumTopic[0].name, "TEAM-200: Implement feature");

    // Verify it's now findable via hasOrchestratorChannel (cache hit)
    assertEquals(m.hasOrchestratorChannel("TEAM-200"), true);
  });
});

Deno.test("createOrchestratorChannel: returns null when not in group mode", async () => {
  await withTestDb(async () => {
    const tc = mockTelegramClient({ isGroupMode: false });
    const m = new TelegramMessenger(tc as never);

    const result = await m.createOrchestratorChannel("TEAM-300", "Title");

    assertEquals(result, null);
    assertEquals(tc._calls.createForumTopic.length, 0);
  });
});

Deno.test("createOrchestratorChannel: returns null when createForumTopic fails", async () => {
  await withTestDb(async () => {
    const tc = mockTelegramClient({
      createForumTopic: async () => null,
    });
    const m = new TelegramMessenger(tc as never);

    const result = await m.createOrchestratorChannel("TEAM-400", "Title");

    assertEquals(result, null);
  });
});

// =============================================================================
// hasOrchestratorChannel()
// =============================================================================

Deno.test("hasOrchestratorChannel: cache hit returns true", async () => {
  await withTestDb(async () => {
    const tc = mockTelegramClient();
    const m = new TelegramMessenger(tc as never);

    // Populate cache via loadChannelsForSession
    upsertChannel("TEAM-500", "telegram", "123");
    m.loadChannelsForSession("TEAM-500");

    assertEquals(m.hasOrchestratorChannel("TEAM-500"), true);
  });
});

Deno.test("hasOrchestratorChannel: cache miss, DB hit returns true", async () => {
  await withTestDb(async () => {
    const tc = mockTelegramClient();
    const m = new TelegramMessenger(tc as never);

    // Only in DB, not cached
    upsertChannel("TEAM-600", "telegram", "456");

    assertEquals(m.hasOrchestratorChannel("TEAM-600"), true);
  });
});

Deno.test("hasOrchestratorChannel: full miss returns false", async () => {
  await withTestDb(async () => {
    const tc = mockTelegramClient();
    const m = new TelegramMessenger(tc as never);

    assertEquals(m.hasOrchestratorChannel("TEAM-UNKNOWN"), false);
  });
});

// =============================================================================
// loadChannelsForSession()
// =============================================================================

Deno.test("loadChannelsForSession: returns channels from DB and caches", async () => {
  await withTestDb(async () => {
    const tc = mockTelegramClient();
    const m = new TelegramMessenger(tc as never);

    upsertChannel("TEAM-700", "telegram", "789");
    upsertChannel("TEAM-700", "slack", "C-SLACK");

    const channels = m.loadChannelsForSession("TEAM-700");

    assertEquals(channels["telegram"], "789");
    assertEquals(channels["slack"], "C-SLACK");

    // After loading, hasOrchestratorChannel should be a cache hit
    assertEquals(m.hasOrchestratorChannel("TEAM-700"), true);
  });
});

// =============================================================================
// resolveSessionByChannel()
// =============================================================================

Deno.test("resolveSessionByChannel: DB hit returns identifier and caches", async () => {
  await withTestDb(async () => {
    const tc = mockTelegramClient();
    const m = new TelegramMessenger(tc as never);

    upsertChannel("TEAM-800", "telegram", "888");

    // First call: DB hit
    const result1 = m.resolveSessionByChannel("telegram", "888");
    assertEquals(result1, "TEAM-800");

    // Second call should use cache (we can't directly verify cache hit,
    // but it shouldn't error and should return same result)
    const result2 = m.resolveSessionByChannel("telegram", "888");
    assertEquals(result2, "TEAM-800");
  });
});

Deno.test("resolveSessionByChannel: miss returns null", async () => {
  await withTestDb(async () => {
    const tc = mockTelegramClient();
    const m = new TelegramMessenger(tc as never);

    const result = m.resolveSessionByChannel("telegram", "nonexistent");
    assertEquals(result, null);
  });
});

// =============================================================================
// client getter
// =============================================================================

Deno.test("client getter: returns the underlying TelegramClient", () => {
  const tc = mockTelegramClient();
  const m = new TelegramMessenger(tc as never);

  // The client getter should return the same object we passed in
  assertEquals(m.client === (tc as never), true);
});
