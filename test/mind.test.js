import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyNiyya, gateAnswer, Flame, commissionText } from "../bees/mind.js";
import { debriefTopic, debriefPayload } from "../bees/hayat.js";

test("niyya", () => {
  assert.deepEqual(classifyNiyya("/ask what is this"), { naw: "query", body: "what is this" });
  assert.deepEqual(classifyNiyya("/do fix it"), { naw: "operation", body: "fix it" });
  assert.deepEqual(classifyNiyya("/sandbox s1 go"), { naw: "sandbox", ism: "s1", body: "go" });
  assert.deepEqual(classifyNiyya("/divine"), { naw: "command", amr: "divine", hujaj: [] });
  assert.equal(classifyNiyya("why?").naw, "query");
  assert.equal(classifyNiyya("build the wall").naw, "operation");
});

test("gate", () => {
  assert.deepEqual(gateAnswer("stop", "  "), { deliver: false, text: "" });
  assert.deepEqual(gateAnswer("stop", "done"), { deliver: true, text: "done" });
  const bad = gateAnswer("error", "broke");
  assert.ok(bad.deliver && bad.text.includes("broke"));
});

test("flame", () => {
  const f = new Flame();
  assert.ok(f.take({ niyya: { naw: "operation", body: "a" }, chatId: 1, sid: null }));
  assert.ok(!f.take({ niyya: { naw: "operation", body: "b" }, chatId: 1, sid: null }));
  f.active.sid = "s1";
  f.feed("s1", "x");
  f.feed("s9", "dropped");
  assert.deepEqual(f.active.chunks, ["x"]);
  const next = f.release();
  assert.equal(next.niyya.body, "b");
  assert.equal(f.active, null);
});

test("commission", () => {
  assert.match(commissionText({ naw: "query", body: "q" }), /sual: q/);
  assert.match(commissionText({ naw: "operation", body: "o" }), /amal: o/);
  assert.match(commissionText({ naw: "sandbox", ism: "s", body: "b" }), /warsha s: b/);
});

test("hayat", () => {
  assert.equal(debriefTopic(), "iksir/debrief");
  const p = debriefPayload("rite", { n: 1 });
  assert.equal(p.kind, "rite");
  assert.equal(typeof p.at, "number");
});
