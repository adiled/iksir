/**
 * Code Intelligence — Query Interpreter
 *
 * Deterministic query engine. Parses natural language queries into
 * structured lookups against the code index. No LLM required.
 *
 * Supports:
 *   Symbol lookup:    "where is SessionManager defined"
 *   Reverse deps:     "what depends on types.ts"
 *   Forward deps:     "what does classifier.ts import"
 *   Export listing:    "exports of pm-server.ts"
 *   Impact analysis:  "impact of changing MunadiConfig"
 *   Search:           "files related to authentication"
 */

import type { CodeIndex, QueryResult, CodeSymbol, FileEntry } from "./types.ts";

// =============================================================================
// Query classification
// =============================================================================

type QueryIntent =
  | { type: "symbol_lookup"; name: string }
  | { type: "reverse_deps"; file: string }
  | { type: "forward_deps"; file: string }
  | { type: "exports"; file: string }
  | { type: "impact"; name: string }
  | { type: "search"; terms: string[] };

function classify(query: string): QueryIntent {
  const q = query.toLowerCase().trim();

  // "where is X" / "who exports X" / "find X" / "X definition"
  const symbolMatch = q.match(
    /(?:where\s+is|who\s+exports?|find|locate|definition\s+of|where\s+does)\s+[`"']?(\w+)[`"']?/
  );
  if (symbolMatch) {
    return { type: "symbol_lookup", name: symbolMatch[1] };
  }

  // "what depends on X" / "who imports X" / "reverse deps of X" / "importers of X"
  const reverseDepsMatch = q.match(
    /(?:what|who)\s+(?:depends\s+on|imports?|uses)\s+[`"']?([^\s`"']+)[`"']?|(?:reverse\s+deps?|importers?|dependents?)\s+(?:of\s+)?[`"']?([^\s`"']+)[`"']?/
  );
  if (reverseDepsMatch) {
    return { type: "reverse_deps", file: reverseDepsMatch[1] ?? reverseDepsMatch[2] };
  }

  // "what does X import" / "deps of X" / "dependencies of X"
  const forwardDepsMatch = q.match(
    /what\s+does\s+[`"']?([^\s`"']+)[`"']?\s+import|(?:deps|dependencies)\s+(?:of\s+)?[`"']?([^\s`"']+)[`"']?/
  );
  if (forwardDepsMatch) {
    return { type: "forward_deps", file: forwardDepsMatch[1] ?? forwardDepsMatch[2] };
  }

  // "exports of X" / "what does X export" / "symbols in X"
  const exportsMatch = q.match(
    /(?:exports?|symbols?)\s+(?:of|in|from)\s+[`"']?([^\s`"']+)[`"']?|what\s+does\s+[`"']?([^\s`"']+)[`"']?\s+export/
  );
  if (exportsMatch) {
    return { type: "exports", file: exportsMatch[1] ?? exportsMatch[2] };
  }

  // "impact of changing X" / "what breaks if I change X" / "change impact X"
  const impactMatch = q.match(
    /impact\s+(?:of\s+)?(?:changing\s+)?[`"']?(\w+)[`"']?|what\s+breaks\s+if\s+(?:I\s+)?change\s+[`"']?(\w+)[`"']?/
  );
  if (impactMatch) {
    return { type: "impact", name: impactMatch[1] ?? impactMatch[2] };
  }

  // If query looks like a bare symbol name (single word, PascalCase or camelCase)
  if (/^\w+$/.test(q) && /[A-Z]/.test(query)) {
    return { type: "symbol_lookup", name: query.trim() };
  }

  // Fallback: search by terms
  const terms = q.split(/\s+/).filter((t) => t.length > 2 && !STOP_WORDS.has(t));
  return { type: "search", terms };
}

const STOP_WORDS = new Set([
  "the", "and", "for", "are", "but", "not", "you", "all", "can", "has",
  "her", "was", "one", "our", "out", "how", "what", "where", "which",
  "who", "does", "that", "this", "with", "from", "have", "been", "will",
  "about", "related", "files", "code",
]);

// =============================================================================
// Query executors
// =============================================================================

function findFile(index: CodeIndex, fileHint: string): FileEntry | null {
  // Exact match
  if (index.files[fileHint]) return index.files[fileHint];

  // Partial match — prefer exact filename, then shortest path
  const matches = Object.values(index.files).filter((f) =>
    f.path.endsWith(fileHint) || f.path.endsWith("/" + fileHint) || f.path.includes(fileHint)
  );

  if (matches.length <= 1) return matches[0] ?? null;

  // Prefer exact basename match (e.g. "types.ts" matches "src/types.ts" over "src/code-intel/types.ts")
  const basenameMatches = matches.filter((f) => {
    const basename = f.path.split("/").pop();
    return basename === fileHint;
  });
  if (basenameMatches.length > 0) {
    // Shortest path wins (closer to root = more likely the main one)
    basenameMatches.sort((a, b) => a.path.length - b.path.length);
    return basenameMatches[0];
  }

  matches.sort((a, b) => a.path.length - b.path.length);
  return matches[0];
}

function findSymbol(index: CodeIndex, name: string): { file: FileEntry; symbol: CodeSymbol }[] {
  const results: { file: FileEntry; symbol: CodeSymbol }[] = [];
  for (const file of Object.values(index.files)) {
    for (const sym of file.symbols) {
      if (sym.name === name || sym.name.toLowerCase() === name.toLowerCase()) {
        results.push({ file, symbol: sym });
      }
    }
  }
  // Exported symbols first, then by file path
  results.sort((a, b) => {
    if (a.symbol.exported && !b.symbol.exported) return -1;
    if (!a.symbol.exported && b.symbol.exported) return 1;
    return a.file.path.localeCompare(b.file.path);
  });
  return results;
}

function findReverseDeps(index: CodeIndex, fileHint: string): FileEntry[] {
  const target = findFile(index, fileHint);
  if (!target) return [];

  const targetPath = target.path;
  const results: FileEntry[] = [];

  for (const file of Object.values(index.files)) {
    if (file.path === targetPath) continue;
    // Check if any import resolves to the target
    for (const imp of file.imports) {
      if (imp.includes(targetPath) || targetPath.includes(imp.replace(/^\.\//, "").replace(/\.\w+$/, ""))) {
        results.push(file);
        break;
      }
    }
  }

  return results;
}

function searchByTerms(index: CodeIndex, terms: string[]): { file: FileEntry; score: number; reason: string }[] {
  const results: { file: FileEntry; score: number; reason: string }[] = [];

  for (const file of Object.values(index.files)) {
    let score = 0;
    const matchReasons: string[] = [];

    for (const term of terms) {
      const termLower = term.toLowerCase();

      // File path match
      if (file.path.toLowerCase().includes(termLower)) {
        score += 3;
        matchReasons.push(`path contains "${term}"`);
      }

      // Symbol name match
      for (const sym of file.symbols) {
        if (sym.name.toLowerCase().includes(termLower)) {
          score += sym.exported ? 2 : 1;
          matchReasons.push(`${sym.kind} ${sym.name}`);
        }
      }
    }

    if (score > 0) {
      results.push({
        file,
        score,
        reason: matchReasons.slice(0, 3).join(", "),
      });
    }
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, 15);
}

// =============================================================================
// Format results
// =============================================================================

function formatSymbol(sym: CodeSymbol, filePath: string): string {
  const exp = sym.exported ? "exported" : "internal";
  const sig = sym.signature ? ` ${sym.signature}` : "";
  return `${sym.kind} ${sym.name}${sig} (${exp}, ${filePath}:${sym.line})`;
}

// =============================================================================
// Main query function
// =============================================================================

export function queryIndex(index: CodeIndex, query: string): QueryResult {
  const intent = classify(query);

  switch (intent.type) {
    case "symbol_lookup": {
      const hits = findSymbol(index, intent.name);
      if (hits.length === 0) {
        return {
          answer: `No symbol "${intent.name}" found in the index.`,
          files: [],
          symbols: [],
        };
      }
      const primary = hits[0];
      const answer = hits.length === 1
        ? `${formatSymbol(primary.symbol, primary.file.path)}`
        : `Found ${hits.length} matches for "${intent.name}". Primary: ${formatSymbol(primary.symbol, primary.file.path)}`;

      return {
        answer,
        files: hits.map((h) => ({ path: h.file.path, reason: `defines ${h.symbol.name}` })),
        symbols: hits.map((h) => ({
          file: h.file.path,
          name: h.symbol.name,
          kind: h.symbol.kind,
          signature: h.symbol.signature,
          line: h.symbol.line,
        })),
      };
    }

    case "reverse_deps": {
      const target = findFile(index, intent.file);
      if (!target) {
        return { answer: `File "${intent.file}" not found in index.`, files: [], symbols: [] };
      }
      const deps = findReverseDeps(index, intent.file);
      if (deps.length === 0) {
        return { answer: `Nothing imports ${target.path}.`, files: [], symbols: [] };
      }
      return {
        answer: `${deps.length} file(s) depend on ${target.path}:\n${deps.map((d) => `  ${d.path}`).join("\n")}`,
        files: deps.map((d) => ({ path: d.path, reason: `imports ${target.path}` })),
        symbols: [],
      };
    }

    case "forward_deps": {
      const target = findFile(index, intent.file);
      if (!target) {
        return { answer: `File "${intent.file}" not found in index.`, files: [], symbols: [] };
      }
      if (target.imports.length === 0) {
        return { answer: `${target.path} has no imports.`, files: [], symbols: [] };
      }
      return {
        answer: `${target.path} imports:\n${target.imports.map((i) => `  ${i}`).join("\n")}`,
        files: target.imports.map((i) => ({ path: i, reason: `imported by ${target.path}` })),
        symbols: [],
      };
    }

    case "exports": {
      const target = findFile(index, intent.file);
      if (!target) {
        return { answer: `File "${intent.file}" not found in index.`, files: [], symbols: [] };
      }
      const exported = target.symbols.filter((s) => s.exported);
      if (exported.length === 0) {
        return { answer: `${target.path} has no exported symbols.`, files: [], symbols: [] };
      }
      return {
        answer: `${target.path} exports:\n${exported.map((s) => `  ${formatSymbol(s, target.path)}`).join("\n")}`,
        files: [{ path: target.path, reason: "queried file" }],
        symbols: exported.map((s) => ({
          file: target.path,
          name: s.name,
          kind: s.kind,
          signature: s.signature,
          line: s.line,
        })),
      };
    }

    case "impact": {
      // Find where the symbol is defined
      const hits = findSymbol(index, intent.name);
      if (hits.length === 0) {
        return { answer: `Symbol "${intent.name}" not found.`, files: [], symbols: [] };
      }

      // Find all files that import from the defining file(s)
      const defFiles = new Set(hits.map((h) => h.file.path));
      const impacted: Set<string> = new Set();

      for (const defFile of defFiles) {
        const deps = findReverseDeps(index, defFile);
        for (const dep of deps) {
          impacted.add(dep.path);
        }
      }

      const defFilesList = [...defFiles].join(", ");
      if (impacted.size === 0) {
        return {
          answer: `${intent.name} is defined in ${defFilesList}. No other files import from there.`,
          files: hits.map((h) => ({ path: h.file.path, reason: `defines ${intent.name}` })),
          symbols: hits.map((h) => ({
            file: h.file.path,
            name: h.symbol.name,
            kind: h.symbol.kind,
            signature: h.symbol.signature,
            line: h.symbol.line,
          })),
        };
      }

      const impactedList = [...impacted].sort();
      return {
        answer: `${intent.name} defined in ${defFilesList}. Changing it impacts ${impacted.size} file(s):\n${impactedList.map((f) => `  ${f}`).join("\n")}`,
        files: [
          ...hits.map((h) => ({ path: h.file.path, reason: `defines ${intent.name}` })),
          ...impactedList.map((f) => ({ path: f, reason: `imports from defining file` })),
        ],
        symbols: hits.map((h) => ({
          file: h.file.path,
          name: h.symbol.name,
          kind: h.symbol.kind,
          signature: h.symbol.signature,
          line: h.symbol.line,
        })),
      };
    }

    case "search": {
      const results = searchByTerms(index, intent.terms);
      if (results.length === 0) {
        return {
          answer: `No files match terms: ${intent.terms.join(", ")}`,
          files: [],
          symbols: [],
        };
      }
      return {
        answer: `${results.length} file(s) match:\n${results.map((r) => `  ${r.file.path} — ${r.reason}`).join("\n")}`,
        files: results.map((r) => ({ path: r.file.path, reason: r.reason })),
        symbols: [],
      };
    }
  }
}
