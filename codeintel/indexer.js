import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { extractTypeScript, extractPython } from "./extract.js";

const IGNORED_DIRS = new Set([
  "node_modules", ".git", "dist", "build", "__pycache__",
  ".venv", "venv", ".tox", ".mypy_cache", ".pytest_cache",
  "graveyard", "backlog", ".deno", "target",
]);

const IGNORED_PATTERNS = [/\.min\./, /\.bundle\./, /\.d\.ts$/];

export function indexPath() {
  const base = process.env.IKSIR_STATE_DIR ??
    join(process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share"), "iksir");
  return join(base, "code-intel.json");
}

async function walkSourceFiles(dir) {
  const files = [];
  async function walk(current) {
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name) || entry.name.startsWith(".")) continue;
        await walk(join(current, entry.name));
      } else if (entry.isFile()) {
        if (IGNORED_PATTERNS.some((p) => p.test(entry.name))) continue;
        if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx") || entry.name.endsWith(".js")) {
          files.push(join(current, entry.name));
        } else if (entry.name.endsWith(".py")) {
          files.push(join(current, entry.name));
        }
      }
    }
  }
  await walk(dir);
  return files;
}

export async function buildIndex(repoPath) {
  const path = indexPath();
  let existing = null;
  if (existsSync(path)) {
    try {
      existing = JSON.parse(await readFile(path, "utf8"));
    } catch {}
  }
  const prev = existing && existing.repoPath === repoPath ? existing.files : {};
  const files = {};
  for (const filePath of await walkSourceFiles(repoPath)) {
    const rel = filePath.startsWith(repoPath) ? filePath.slice(repoPath.length + 1) : filePath;
    const lang = filePath.endsWith(".py") ? "python" : "typescript";
    const entry = lang === "python"
      ? await extractPython(filePath, repoPath)
      : await extractTypeScript(filePath, repoPath);
    if (!entry) continue;
    const old = prev[rel];
    files[rel] = old && old.hash === entry.hash ? old : entry;
  }
  const index = { version: 1, builtAt: new Date().toISOString(), repoPath, files };
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(index));
  return index;
}

export async function loadIndex(repoPath) {
  const path = indexPath();
  if (existsSync(path)) {
    try {
      const index = JSON.parse(await readFile(path, "utf8"));
      if (index.repoPath === repoPath) return index;
    } catch {}
  }
  return buildIndex(repoPath);
}
