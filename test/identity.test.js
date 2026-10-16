import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beeHid } from "../hum/identity.js";

test("hid", () => {
  process.env.XDG_STATE_HOME = mkdtempSync(join(tmpdir(), "iksir-id-"));
  const a = beeHid("iksir-tools", "fbee");
  assert.match(a, /^fbee_[0-9a-f]{64}$/);
  assert.equal(beeHid("iksir-tools", "fbee"), a);
  const w = beeHid("iksir-mind", "wbee");
  assert.match(w, /^wbee_[0-9a-f]{64}$/);
  assert.notEqual(a, w);
});
