import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFileSync, unlinkSync } from "node:fs";

const pExecFile = promisify(execFile);

export function fileHash(content) {
  return createHash("sha256").update(content, "utf8").digest("hex").slice(0, 12);
}

function extractImportsTs(content) {
  const imports = [];
  const re = /(?:import|export)\s+.*?from\s+["']([^"']+)["']|import\s+["']([^"']+)["']/g;
  let m;
  while ((m = re.exec(content)) !== null) imports.push(m[1] ?? m[2]);
  return imports;
}

const TS_DECL_RES = [
  [/^(?:export\s+)?(?:async\s+)?function\s+(\w+)/, "function"],
  [/^(?:export\s+)?class\s+(\w+)/, "class"],
  [/^(?:export\s+)?interface\s+(\w+)/, "interface"],
  [/^(?:export\s+)?type\s+(\w+)/, "type"],
  [/^(?:export\s+)?const\s+(\w+)/, "const"],
  [/^(?:export\s+)?enum\s+(\w+)/, "enum"],
  [/^(?:export\s+)?(?:public|private|protected)?\s*(?:async\s+)?(\w+)\s*\(.*\)\s*[:{]/, "method"],
];

export function extractSymbolsTs(content) {
  const symbols = [];
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trimStart();
    if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("*")) continue;
    for (const [re, kind] of TS_DECL_RES) {
      if (kind === "method" && !/^\s+/.test(line)) continue;
      const m = line.match(re);
      if (m && m[1] && !symbols.find((s) => s.name === m[1])) {
        symbols.push({ name: m[1], kind, line: i + 1, exported: trimmed.startsWith("export ") });
        break;
      }
    }
  }
  return symbols;
}

export async function extractTypeScript(filePath, repoPath) {
  let content;
  try {
    content = await readFile(filePath, "utf8");
  } catch {
    return null;
  }
  return {
    path: rel(filePath, repoPath),
    hash: fileHash(content),
    language: "typescript",
    symbols: extractSymbolsTs(content),
    imports: extractImportsTs(content),
  };
}

const AST_SCRIPT = `
import ast, json, sys
with open(sys.argv[1], 'r') as f:
    tree = ast.parse(f.read())
symbols, imports = [], []
for node in ast.iter_child_nodes(tree):
    if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
        args = ', '.join(a.arg for a in node.args.args)
        ret = ast.unparse(node.returns) if node.returns else ''
        symbols.append({"name": node.name, "kind": "function",
          "signature": f"({args})" + (f" -> {ret}" if ret else ""),
          "line": node.lineno, "exported": not node.name.startswith('_')})
    elif isinstance(node, ast.ClassDef):
        symbols.append({"name": node.name, "kind": "class",
          "line": node.lineno, "exported": not node.name.startswith('_')})
    elif isinstance(node, ast.Assign):
        for target in node.targets:
            if isinstance(target, ast.Name):
                symbols.append({"name": target.id,
                  "kind": "const" if target.id.isupper() else "variable",
                  "line": node.lineno, "exported": not target.id.startswith('_')})
    elif isinstance(node, ast.Import):
        imports.extend(a.name for a in node.names)
    elif isinstance(node, ast.ImportFrom):
        if node.module: imports.append(node.module)
json.dump({"symbols": symbols, "imports": imports}, sys.stdout)
`;

function extractImportsPy(content) {
  const imports = [];
  const re = /^(?:from\s+(\S+)\s+import|import\s+(\S+))/gm;
  let m;
  while ((m = re.exec(content)) !== null) imports.push(m[1] ?? m[2]);
  return imports;
}

export function extractSymbolsPy(content) {
  const symbols = [];
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s/.test(line) || !line) continue;
    let m = line.match(/^(?:async\s+)?def\s+(\w+)\s*\(([^)]*)\)/);
    if (m) {
      symbols.push({ name: m[1], kind: "function", signature: `(${m[2]})`, line: i + 1, exported: !m[1].startsWith("_") });
      continue;
    }
    m = line.match(/^class\s+(\w+)/);
    if (m) {
      symbols.push({ name: m[1], kind: "class", line: i + 1, exported: !m[1].startsWith("_") });
      continue;
    }
    m = line.match(/^(\w+)\s*[=:]/);
    if (m && !/^(if|for|while|with|return|import|from)\b/.test(line)) {
      symbols.push({ name: m[1], kind: m[1] === m[1].toUpperCase() ? "const" : "variable", line: i + 1, exported: !m[1].startsWith("_") });
    }
  }
  return symbols;
}

export async function extractPython(filePath, repoPath) {
  let content;
  try {
    content = await readFile(filePath, "utf8");
  } catch {
    return null;
  }
  let symbols, imports;
  const tmp = join(tmpdir(), `iksir-ast-${process.pid}-${Date.now()}.py`);
  try {
    writeFileSync(tmp, AST_SCRIPT);
    const { stdout } = await pExecFile("python3", [tmp, filePath], { cwd: repoPath });
    const parsed = JSON.parse(stdout);
    symbols = parsed.symbols;
    imports = parsed.imports;
  } catch {
    symbols = extractSymbolsPy(content);
    imports = extractImportsPy(content);
  } finally {
    try { unlinkSync(tmp); } catch {}
  }
  return { path: rel(filePath, repoPath), hash: fileHash(content), language: "python", symbols, imports };
}

function rel(filePath, repoPath) {
  return filePath.startsWith(repoPath) ? filePath.slice(repoPath.length + 1) : filePath;
}
