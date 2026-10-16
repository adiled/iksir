import { test } from "node:test";
import assert from "node:assert/strict";
import { Chi, PulseKind, THRUM_VERSION, isValidChi, isEnvelope, isKnownTone, rid, isValidRid, sigil, duskIn, isDusk, WaneTracker, tone, frameLines, sockPath } from "../hum/wire.js";

test("pin", () => {
  assert.equal(THRUM_VERSION, "0.7.0");
  assert.equal(Chi.toolCall, "tool-call");
  assert.equal(Chi.releasePermit, "release-permit");
  assert.equal(Chi.gossipPublish, "gossip-publish");
  assert.equal(PulseKind.cellDied, "cell-died");
});

test("chi", () => {
  assert.ok(isValidChi("prompt"));
  assert.ok(!isValidChi("nope"));
  assert.ok(isEnvelope({ chi: "prompt", rid: "x" }));
  assert.ok(!isEnvelope({ rid: "x" }));
  assert.ok(isKnownTone({ chi: "chunk", rid: "x", sid: "s" }));
  assert.ok(!isKnownTone({ chi: "nope", rid: "x" }));
});

test("rid", () => {
  const a = rid();
  const b = rid();
  assert.ok(isValidRid(a));
  assert.notEqual(a, b);
  assert.ok(!isValidRid("short"));
});

test("sigil", () => {
  const s = sigil("sid-1", "claude-repl");
  assert.match(s, /^[0-9a-f]{12}$/);
  assert.equal(s, sigil("sid-1", "claude-repl"));
  assert.notEqual(s, sigil("sid-2", "claude-repl"));
});

test("dusk", () => {
  assert.ok(isDusk({ dusk: Date.now() - 1000 }));
  assert.ok(!isDusk({ dusk: duskIn(60000) }));
  assert.ok(!isDusk({}));
});

test("wane", () => {
  const w = new WaneTracker();
  assert.equal(w.get("s"), 0);
  assert.equal(w.tick("s"), 1);
  assert.equal(w.tick("s"), 2);
  assert.ok(w.behind("s", 5));
  assert.ok(!w.behind("s", 1));
  w.set("s", 9);
  assert.equal(w.get("s"), 9);
});

test("tone", () => {
  const t = tone("prompt", { text: "hi" }, { sid: "s" });
  assert.equal(t.chi, "prompt");
  assert.ok(isValidRid(t.rid));
  assert.equal(t.sid, "s");
  assert.equal(typeof t.sentAt, "number");
});

test("framer", () => {
  const push = frameLines();
  const got = [];
  push('{"a":1}\n{"b"', (l) => got.push(l));
  assert.deepEqual(got, ['{"a":1}']);
  push(':2}\n\n{"c":3}\n', (l) => got.push(l));
  assert.deepEqual(got, ['{"a":1}', '{"b":2}', '{"c":3}']);
});

test("sock", () => {
  process.env.HUM_THRUM_SOCK = "/tmp/x.sock";
  assert.equal(sockPath(), "/tmp/x.sock");
  delete process.env.HUM_THRUM_SOCK;
  assert.match(sockPath(), /hum\/thrum\.sock$/);
});
