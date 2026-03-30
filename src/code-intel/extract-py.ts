/**
 * Code Intelligence — Python symbol extraction
 *
 * Uses Python's ast module for accurate parsing.
 * Falls back to regex if python3 is not available.
 */

import type { CodeSymbol, FileEntry } from "./types.ts";
import { execCommand } from "../utils/exec.ts";
import { encodeHex } from "jsr:@std/encoding/hex";

async function fileHash(content: string): Promise<string> {
  const data = new TextEncoder().encode(content);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return encodeHex(new Uint8Array(hash)).slice(0, 12);
}

const AST_SCRIPT = `
import ast, json, sys

with open(sys.argv[1], 'r') as f:
    tree = ast.parse(f.read())

symbols = []
imports = []

for node in ast.iter_child_nodes(tree):
    if isinstance(node, ast.FunctionDef) or isinstance(node, ast.AsyncFunctionDef):
        args = ', '.join(a.arg for a in node.args.args)
        ret = ''
        if node.returns:
            ret = ast.unparse(node.returns)
        sig = f"({args})" + (f" -> {ret}" if ret else "")
        exported = not node.name.startswith('_')
        symbols.append({
            "name": node.name,
            "kind": "function",
            "signature": sig,
            "line": node.lineno,
            "exported": exported
        })
    elif isinstance(node, ast.ClassDef):
        exported = not node.name.startswith('_')
        symbols.append({
            "name": node.name,
            "kind": "class",
            "line": node.lineno,
            "exported": exported
        })
    elif isinstance(node, ast.Assign):
        for target in node.targets:
            if isinstance(target, ast.Name):
                exported = not target.id.startswith('_')
                kind = "const" if target.id.isupper() else "variable"
                symbols.append({
                    "name": target.id,
                    "kind": kind,
                    "line": node.lineno,
                    "exported": exported
                })
    elif isinstance(node, ast.Import):
        for alias in node.names:
            imports.append(alias.name)
    elif isinstance(node, ast.ImportFrom):
        if node.module:
            imports.append(node.module)

json.dump({"symbols": symbols, "imports": imports}, sys.stdout)
`;

function extractImportsRegex(content: string): string[] {
  const imports: string[] = [];
  const re = /^(?:from\s+(\S+)\s+import|import\s+(\S+))/gm;
  let m;
  while ((m = re.exec(content)) !== null) {
    imports.push(m[1] ?? m[2]);
  }
  return imports;
}

function extractSymbolsRegex(content: string): CodeSymbol[] {
  const symbols: CodeSymbol[] = [];
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    if (line.startsWith(" ") || line.startsWith("\t")) continue;

    const funcMatch = line.match(/^(?:async\s+)?def\s+(\w+)\s*\(([^)]*)\)/);
    if (funcMatch) {
      const name = funcMatch[1];
      symbols.push({
        name,
        kind: "function",
        signature: `(${funcMatch[2]})`,
        line: lineNum,
        exported: !name.startsWith("_"),
      });
      continue;
    }

    const classMatch = line.match(/^class\s+(\w+)/);
    if (classMatch) {
      symbols.push({
        name: classMatch[1],
        kind: "class",
        line: lineNum,
        exported: !classMatch[1].startsWith("_"),
      });
      continue;
    }

    const assignMatch = line.match(/^(\w+)\s*[=:]/);
    if (assignMatch && !line.startsWith("if ") && !line.startsWith("for ")) {
      const name = assignMatch[1];
      symbols.push({
        name,
        kind: name === name.toUpperCase() ? "const" : "variable",
        line: lineNum,
        exported: !name.startsWith("_"),
      });
    }
  }

  return symbols;
}

/**
 * Extract symbols from a Python file.
 *
 * Tries python3 AST parsing first, falls back to regex.
 */
export async function extractPython(filePath: string, repoPath: string): Promise<FileEntry | null> {
  let content: string;
  try {
    content = await Deno.readTextFile(filePath);
  } catch {
    return null;
  }

  const hash = await fileHash(content);
  let symbols: CodeSymbol[];
  let imports: string[];

  /** Try python3 AST */
  const tmpScript = await Deno.makeTempFile({ suffix: ".py" });
  try {
    await Deno.writeTextFile(tmpScript, AST_SCRIPT);
    const result = await execCommand("python3", [tmpScript, filePath], { cwd: repoPath });
    if (result.success) {
      const parsed = JSON.parse(result.stdout);
      symbols = parsed.symbols;
      imports = parsed.imports;
    } else {
      symbols = extractSymbolsRegex(content);
      imports = extractImportsRegex(content);
    }
  } catch {
    symbols = extractSymbolsRegex(content);
    imports = extractImportsRegex(content);
  } finally {
    try { await Deno.remove(tmpScript); } catch { /* ignore */ }
  }

  const relativePath = filePath.startsWith(repoPath)
    ? filePath.slice(repoPath.length + 1)
    : filePath;

  return {
    path: relativePath,
    hash,
    language: "python",
    symbols,
    imports,
  };
}
