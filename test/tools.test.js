import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import { dispatchTool, TOOLS } from "../bees/tools.js";

const HERE = dirname(fileURLToPath(import.meta.url));

test("registry", () => {
  const names = TOOLS.map((t) => t.name);
  for (const n of ["code_lookup", "code_reverse_deps", "code_forward_deps", "code_exports", "code_impact", "code_search", "mur_far_list", "mur_far_create", "mur_far_status"]) {
    assert.ok(names.includes(n));
  }
  for (const t of TOOLS) {
    assert.equal(typeof t.description, "string");
    assert.equal(t.inputSchema.type, "object");
  }
});

test("dispatch", async () => {
  process.env.IKSIR_STATE_DIR = mkdtempSync(join(tmpdir(), "iksir-t-"));
  process.env.IKSIR_REPO = join(HERE, "fixtures");
  const out = await dispatchTool("code_lookup", { query: "where is beta defined" });
  assert.match(out, /beta\.js/);
  await assert.rejects(() => dispatchTool("nope", {}), /unknown/);
});

test("vessels", async () => {
  const dir = mkdtempSync(join(tmpdir(), "iksir-git-"));
  execSync("git init -b main", { cwd: dir });
  execSync('git -c user.email=t@t -c user.name=t commit --allow-empty -m x', { cwd: dir });
  const list = await dispatchTool("mur_far_list", { repo: dir });
  assert.match(list, /main/);
  const made = await dispatchTool("mur_far_create", { repo: dir, name: "vtest" });
  assert.match(made, /vtest/);
  const status = await dispatchTool("mur_far_status", { repo: dir });
  assert.match(status, /vtest/);
  assert.match(status, /clean/);
});
