/**
 * Code Intelligence — TypeScript/Deno symbol extraction
 *
 * Uses `deno doc --json` for exports, regex for imports.
 * No external dependencies.
 */

import type { CodeSymbol, FileEntry } from "./types.ts";
import { execCommand } from "../utils/exec.ts";
import { encodeHex } from "jsr:@std/encoding/hex";

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

/** deno-lint-ignore no-explicit-any */
function mapDocNode(node: any, exported: boolean): CodeSymbol | null {
  const name: string = node.name ?? "";
  const line: number = node.location?.line ?? 0;

  switch (node.kind) {
    case "function": {
      const params = (node.functionDef?.params ?? [])
        .map((p: any) => {
          const pName = p.name ?? p.left?.name ?? "_";
          const pType = p.tsType?.repr ?? p.tsType?.keyword ?? "";
          return pType ? `${pName}: ${pType}` : pName;
        })
        .join(", ");
      const ret = node.functionDef?.returnType?.repr ?? node.functionDef?.returnType?.keyword ?? "";
      const sig = ret ? `(${params}): ${ret}` : `(${params})`;
      return { name, kind: "function", signature: sig, line, exported };
    }
    case "class":
      return { name, kind: "class", line, exported };
    case "interface":
      return { name, kind: "interface", line, exported };
    case "typeAlias":
      return { name, kind: "type", line, exported };
    case "enum":
      return { name, kind: "enum", line, exported };
    case "variable": {
      const varKind = node.variableDef?.kind ?? "const";
      return { name, kind: varKind === "const" ? "const" : "variable", line, exported };
    }
    default:
      return null;
  }
}

/**
 * Extract symbols from a TypeScript file.
 *
 * Uses `deno doc --json` for exported symbols, plus regex for imports
 * and unexported top-level declarations.
 */
export async function extractTypeScript(filePath: string, repoPath: string): Promise<FileEntry | null> {
  let content: string;
  try {
    content = await Deno.readTextFile(filePath);
  } catch {
    return null;
  }

  const hash = await fileHash(content);
  const imports = extractImports(content);
  const symbols: CodeSymbol[] = [];

  /** Use deno doc for exported symbols */
  const denoBin = Deno.execPath();
  const result = await execCommand(denoBin, ["doc", "--json", filePath], { cwd: repoPath });
  if (result.success) {
    try {
      const nodes = JSON.parse(result.stdout);
      if (Array.isArray(nodes)) {
        for (const node of nodes) {
          const sym = mapDocNode(node, true);
          if (sym) symbols.push(sym);
        }
      }
    } catch {
    }
  }

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
