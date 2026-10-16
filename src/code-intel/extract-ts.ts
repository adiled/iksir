/**
 * Code Intelligence — TypeScript symbol extraction
 *
 * Regex for exports, imports, and top-level declarations.
 * No external dependencies.
 */

import type { CodeSymbol, FileEntry } from "./types.ts";
import { readFileSync } from "node:fs";
const encodeHex = (b: Uint8Array): string => Buffer.from(b).toString("hex");

async function fileHash(content: string): Promise<string> {
  const data = new TextEncoder().encode(content);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return encodeHex(new Uint8Array(hash)).slice(0, 12);
}

function extractImports(content: string): string[] {
  const imports: string[] = [];
  /** Match: import ... from "..."  and  import "..."  and  export ... from "..." */
  const re = /(?:import|export)\s+.*?from\s+["']([^"']+)["']|import\s+["']([^"']+)["']/g;
  let m;
  while ((m = re.exec(content)) !== null) {
    imports.push(m[1] ?? m[2]);
  }
  return imports;
}


/**
 * Extract symbols from a TypeScript file.
 *
 * Regex for exports, imports, and top-level declarations.
 */
export async function extractTypeScript(filePath: string, repoPath: string): Promise<FileEntry | null> {
  let content: string;
  try {
    content = readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }

  const hash = await fileHash(content);
  const imports = extractImports(content);
  const symbols: CodeSymbol[] = [];

  /** Regex fallback for non-exported top-level declarations */
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    /** Skip if already captured as export */
    const isExported = line.trimStart().startsWith("export ");

    if (line.match(/^(?:export\s+)?(?:async\s+)?function\s+(\w+)/)) {
      const name = line.match(/function\s+(\w+)/)?.[1];
      if (name && !symbols.find((s) => s.name === name)) {
        symbols.push({ name, kind: "function", line: lineNum, exported: isExported });
      }
    } else if (line.match(/^(?:export\s+)?class\s+(\w+)/)) {
      const name = line.match(/class\s+(\w+)/)?.[1];
      if (name && !symbols.find((s) => s.name === name)) {
        symbols.push({ name, kind: "class", line: lineNum, exported: isExported });
      }
    } else if (line.match(/^(?:export\s+)?interface\s+(\w+)/)) {
      const name = line.match(/interface\s+(\w+)/)?.[1];
      if (name && !symbols.find((s) => s.name === name)) {
        symbols.push({ name, kind: "interface", line: lineNum, exported: isExported });
      }
    } else if (line.match(/^(?:export\s+)?type\s+(\w+)/)) {
      const name = line.match(/type\s+(\w+)/)?.[1];
      if (name && !symbols.find((s) => s.name === name)) {
        symbols.push({ name, kind: "type", line: lineNum, exported: isExported });
      }
    } else if (line.match(/^(?:export\s+)?const\s+(\w+)/)) {
      const name = line.match(/const\s+(\w+)/)?.[1];
      if (name && !symbols.find((s) => s.name === name)) {
        symbols.push({ name, kind: "const", line: lineNum, exported: isExported });
      }
    } else if (line.match(/^(?:export\s+)?enum\s+(\w+)/)) {
      const name = line.match(/enum\s+(\w+)/)?.[1];
      if (name && !symbols.find((s) => s.name === name)) {
        symbols.push({ name, kind: "enum", line: lineNum, exported: isExported });
      }
    }
  }

  const relativePath = filePath.startsWith(repoPath)
    ? filePath.slice(repoPath.length + 1)
    : filePath;

  return {
    path: relativePath,
    hash,
    language: "typescript",
    symbols,
    imports,
  };
}
