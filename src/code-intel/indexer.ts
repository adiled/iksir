/**
 * Code Intelligence — Indexer
 *
 * Walks a repository, extracts symbols from TS/Python files,
 * persists as JSON. Incremental: only re-indexes changed files.
 */

import { join } from "node:path";
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { extractTypeScript } from "./extract-ts.ts";
import { extractPython } from "./extract-py.ts";
import type { CodeIndex, FileEntry } from "./types.ts";
import { logger } from "../logging/logger.ts";

const IGNORED_DIRS = new Set([
  "node_modules", ".git", "dist", "build", "__pycache__",
  ".venv", "venv", ".tox", ".mypy_cache", ".pytest_cache",
  "graveyard", "backlog", ".deno",
]);

const IGNORED_PATTERNS = [
  /\.min\./,
  /\.bundle\./,
  /\.d\.ts$/,
];

function getIndexPath(): string {
  const dataDir = process.env.IKSIR_STATE_DIR ??
    join(process.env.XDG_DATA_HOME ?? join(process.env.HOME ?? ".", ".local", "share"), "iksir");
  return join(dataDir, "code-intel.json");
}

async function walkSourceFiles(dir: string): Promise<string[]> {
  const files: string[] = [];

  function walk(current: string) {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name) || entry.name.startsWith(".")) continue;
        walk(join(current, entry.name));
      } else if (entry.isFile()) {
        const path = join(current, entry.name);
        if (IGNORED_PATTERNS.some((p) => p.test(entry.name))) continue;

        if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
          files.push(path);
        } else if (entry.name.endsWith(".py")) {
          files.push(path);
        }
      }
    }
  }

  walk(dir);
  return files;
}

function detectLanguage(filePath: string): "typescript" | "python" {
  return filePath.endsWith(".py") ? "python" : "typescript";
}

async function extractFile(filePath: string, repoPath: string): Promise<FileEntry | null> {
  const lang = detectLanguage(filePath);
  if (lang === "typescript") {
    return await extractTypeScript(filePath, repoPath);
  } else {
    return await extractPython(filePath, repoPath);
  }
}

/**
 * Build or incrementally update the code intelligence index.
 */
export async function buildIndex(repoPath: string): Promise<CodeIndex> {
  const indexPath = getIndexPath();
  let existing: CodeIndex | null = null;

  if (existsSync(indexPath)) {
    try {
      const content = readFileSync(indexPath, "utf-8");
      existing = JSON.parse(content) as CodeIndex;
      if (existing.repoPath !== repoPath) existing = null;
    } catch {
      existing = null;
    }
  }

  const index: CodeIndex = {
    version: 1,
    builtAt: new Date().toISOString(),
    repoPath,
    files: {},
  };

  const sourceFiles = await walkSourceFiles(repoPath);
  let indexed = 0;
  let reused = 0;

  for (const filePath of sourceFiles) {
    if (existing) {
      const relativePath = filePath.startsWith(repoPath)
        ? filePath.slice(repoPath.length + 1)
        : filePath;
      const prev = existing.files[relativePath];
      if (prev) {
        try {
          const content = readFileSync(filePath, "utf-8");
          const data = new TextEncoder().encode(content);
          const hashBuf = await crypto.subtle.digest("SHA-256", data);
          const { encodeHex } = { encodeHex: (b: Uint8Array): string => Buffer.from(b).toString("hex") };
          const hash = encodeHex(new Uint8Array(hashBuf)).slice(0, 12);
          if (prev.hash === hash) {
            index.files[relativePath] = prev;
            reused++;
            continue;
          }
        } catch {
        }
      }
    }

    const entry = await extractFile(filePath, repoPath);
    if (entry) {
      index.files[entry.path] = entry;
      indexed++;
    }
  }

  mkdirSync(join(indexPath, ".."), { recursive: true });
  writeFileSync(indexPath, JSON.stringify(index, null, 2));

  await logger.akhbar("code-intel", `Index built: ${indexed} indexed, ${reused} reused, ${Object.keys(index.files).length} total files`);

  return index;
}

/**
 * Load the persisted index, or null if not found.
 */
export async function loadIndex(): Promise<CodeIndex | null> {
  const indexPath = getIndexPath();
  try {
    const content = readFileSync(indexPath, "utf-8");
    return JSON.parse(content) as CodeIndex;
  } catch {
    return null;
  }
}

/**
 * Check how stale the index is (hours since last build).
 */
export function indexAge(index: CodeIndex): number {
  const built = new Date(index.builtAt).getTime();
  return (Date.now() - built) / (1000 * 60 * 60);
}
