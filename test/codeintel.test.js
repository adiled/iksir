import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { extractSymbolsTs, extractSymbolsPy } from "../codeintel/extract.js";
import { buildIndex, loadIndex } from "../codeintel/indexer.js";
import { queryIndex } from "../codeintel/query.js";

const HERE = dirname(fileURLToPath(import.meta.url));

test("ts", () => {
  const syms = extractSymbolsTs("export function alpha() {\n}\nconst x = 1;\n  methodCall() {\n}\n");
  assert.equal(syms[0].name, "alpha");
  assert.equal(syms[0].kind, "function");
  assert.ok(syms[0].exported);
  assert.equal(syms[1].name, "x");
});

test("py", () => {
  const syms = extractSymbolsPy("def f(a):\n    pass\n\nclass C:\n    pass\n\nFLAG = 1\n");
  assert.equal(syms[0].name, "f");
  assert.equal(syms[0].signature, "(a)");
  assert.equal(syms[1].kind, "class");
  assert.equal(syms[2].kind, "const");
});

test("index", async () => {
  process.env.IKSIR_STATE_DIR = mkdtempSync(join(tmpdir(), "iksir-idx-"));
  const repo = join(HERE, "fixtures");
  const index = await buildIndex(repo);
  assert.ok(index.files["alpha.js"]);
  assert.ok(index.files["beta.js"]);
  assert.ok(index.files["alpha.js"].symbols.some((s) => s.name === "alpha"));
  const again = await loadIndex(repo);
  assert.equal(again.builtAt, index.builtAt);
});

test("query", async () => {
  const repo = join(HERE, "fixtures");
  const index = await loadIndex(repo);
  const hit = queryIndex(index, "where is alpha defined");
  assert.match(hit.answer, /alpha\.js/);
  const rev = queryIndex(index, "what depends on alpha.js");
  assert.match(rev.answer, /beta\.js/);
  const fwd = queryIndex(index, "what does beta.js import");
  assert.match(fwd.answer, /alpha/);
  const exp = queryIndex(index, "exports of beta.js");
  assert.match(exp.answer, /beta/);
  const miss = queryIndex(index, "where is zzz defined");
  assert.equal(miss.symbols.length, 0);
});
