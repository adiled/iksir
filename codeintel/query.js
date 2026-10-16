function mayyaza(query) {
  const q = query.toLowerCase().trim();
  let m = q.match(/(?:where\s+is|who\s+exports?|find|locate|definition\s+of|where\s+does)\s+[`"']?(\w+)[`"']?/);
  if (m) return { type: "symbol_lookup", name: m[1] };
  m = q.match(/(?:what|who)\s+(?:depends\s+on|imports?|uses)\s+[`"']?([^\s`"']+)[`"']?|(?:reverse\s+deps?|importers?|dependents?)\s+(?:of\s+)?[`"']?([^\s`"']+)[`"']?/);
  if (m) return { type: "reverse_deps", file: m[1] ?? m[2] };
  m = q.match(/what\s+does\s+[`"']?([^\s`"']+)[`"']?\s+import|(?:deps|dependencies)\s+(?:of\s+)?[`"']?([^\s`"']+)[`"']?/);
  if (m) return { type: "forward_deps", file: m[1] ?? m[2] };
  m = q.match(/(?:exports?|symbols?)\s+(?:of|in|from)\s+[`"']?([^\s`"']+)[`"']?|what\s+does\s+[`"']?([^\s`"']+)[`"']?\s+export/);
  if (m) return { type: "exports", file: m[1] ?? m[2] };
  m = q.match(/impact\s+(?:of\s+)?(?:changing\s+)?[`"']?(\w+)[`"']?|what\s+breaks\s+if\s+(?:I\s+)?change\s+[`"']?(\w+)[`"']?/);
  if (m) return { type: "impact", name: m[1] ?? m[2] };
  if (/^\w+$/.test(q) && /[A-Z]/.test(query)) return { type: "symbol_lookup", name: query.trim() };
  const terms = q.split(/\s+/).filter((t) => t.length > 2 && !STOP_WORDS.has(t));
  return { type: "search", terms };
}

const STOP_WORDS = new Set([
  "the", "and", "for", "are", "but", "not", "you", "all", "can", "has",
  "her", "was", "one", "our", "out", "how", "what", "where", "which",
  "who", "does", "that", "this", "with", "from", "have", "been", "will",
  "about", "related", "files", "code",
]);

function findFile(index, fileHint) {
  if (index.files[fileHint]) return index.files[fileHint];
  const matches = Object.values(index.files).filter(
    (f) => f.path.endsWith(fileHint) || f.path.endsWith("/" + fileHint) || f.path.includes(fileHint),
  );
  if (matches.length <= 1) return matches[0] ?? null;
  const base = matches.filter((f) => f.path.split("/").pop() === fileHint);
  const pool = base.length > 0 ? base : matches;
  pool.sort((a, b) => a.path.length - b.path.length);
  return pool[0];
}

function findSymbol(index, name) {
  const results = [];
  for (const file of Object.values(index.files)) {
    for (const sym of file.symbols) {
      if (sym.name === name || sym.name.toLowerCase() === name.toLowerCase()) results.push({ file, symbol: sym });
    }
  }
  results.sort((a, b) => {
    if (a.symbol.exported && !b.symbol.exported) return -1;
    if (!a.symbol.exported && b.symbol.exported) return 1;
    return a.file.path.localeCompare(b.file.path);
  });
  return results;
}

function findReverseDeps(index, fileHint) {
  const target = findFile(index, fileHint);
  if (!target) return [];
  const out = [];
  for (const file of Object.values(index.files)) {
    if (file.path === target.path) continue;
    for (const imp of file.imports) {
      if (imp.includes(target.path) || target.path.includes(imp.replace(/^\.\//, ""))) {
        out.push(file);
        break;
      }
    }
  }
  return out;
}

function searchByTerms(index, terms) {
  const results = [];
  for (const file of Object.values(index.files)) {
    let score = 0;
    const reasons = [];
    for (const term of terms) {
      const tl = term.toLowerCase();
      if (file.path.toLowerCase().includes(tl)) {
        score += 3;
        reasons.push(`path contains "${term}"`);
      }
      for (const sym of file.symbols) {
        if (sym.name.toLowerCase().includes(tl)) {
          score += sym.exported ? 2 : 1;
          reasons.push(`${sym.kind} ${sym.name}`);
        }
      }
    }
    if (score > 0) results.push({ file, score, reason: reasons.slice(0, 3).join(", ") });
  }
  results.sort((a, b) => b.score - a.score);
  return results.slice(0, 15);
}

function formatSymbol(sym, filePath) {
  const exp = sym.exported ? "exported" : "internal";
  const sig = sym.signature ? ` ${sym.signature}` : "";
  return `${sym.kind} ${sym.name}${sig} (${exp}, ${filePath}:${sym.line})`;
}

const symOut = (h) => ({ file: h.file.path, name: h.symbol.name, kind: h.symbol.kind, signature: h.symbol.signature, line: h.symbol.line });

export function queryIndex(index, query) {
  const intent = mayyaza(query);
  switch (intent.type) {
    case "symbol_lookup": {
      const hits = findSymbol(index, intent.name);
      if (hits.length === 0) return { answer: `No symbol "${intent.name}" found in the index.`, files: [], symbols: [] };
      const answer = hits.length === 1
        ? `${formatSymbol(hits[0].symbol, hits[0].file.path)}`
        : `Found ${hits.length} matches for "${intent.name}". Primary: ${formatSymbol(hits[0].symbol, hits[0].file.path)}`;
      return { answer, files: hits.map((h) => ({ path: h.file.path, reason: `defines ${h.symbol.name}` })), symbols: hits.map(symOut) };
    }
    case "reverse_deps": {
      const target = findFile(index, intent.file);
      if (!target) return { answer: `File "${intent.file}" not found in index.`, files: [], symbols: [] };
      const deps = findReverseDeps(index, intent.file);
      if (deps.length === 0) return { answer: `Nothing imports ${target.path}.`, files: [], symbols: [] };
      return {
        answer: `${deps.length} file(s) depend on ${target.path}:\n${deps.map((d) => `  ${d.path}`).join("\n")}`,
        files: deps.map((d) => ({ path: d.path, reason: `imports ${target.path}` })),
        symbols: [],
      };
    }
    case "forward_deps": {
      const target = findFile(index, intent.file);
      if (!target) return { answer: `File "${intent.file}" not found in index.`, files: [], symbols: [] };
      if (target.imports.length === 0) return { answer: `${target.path} has no imports.`, files: [], symbols: [] };
      return {
        answer: `${target.path} imports:\n${target.imports.map((i) => `  ${i}`).join("\n")}`,
        files: target.imports.map((i) => ({ path: i, reason: `imported by ${target.path}` })),
        symbols: [],
      };
    }
    case "exports": {
      const target = findFile(index, intent.file);
      if (!target) return { answer: `File "${intent.file}" not found in index.`, files: [], symbols: [] };
      const exported = target.symbols.filter((s) => s.exported);
      if (exported.length === 0) return { answer: `${target.path} has no exported symbols.`, files: [], symbols: [] };
      return {
        answer: `${target.path} exports:\n${exported.map((s) => `  ${formatSymbol(s, target.path)}`).join("\n")}`,
        files: [{ path: target.path, reason: "queried file" }],
        symbols: exported.map((s) => ({ file: target.path, name: s.name, kind: s.kind, signature: s.signature, line: s.line })),
      };
    }
    case "impact": {
      const hits = findSymbol(index, intent.name);
      if (hits.length === 0) return { answer: `Symbol "${intent.name}" not found.`, files: [], symbols: [] };
      const defFiles = new Set(hits.map((h) => h.file.path));
      const impacted = new Set();
      for (const defFile of defFiles) {
        for (const dep of findReverseDeps(index, defFile)) impacted.add(dep.path);
      }
      const defList = [...defFiles].join(", ");
      if (impacted.size === 0) {
        return {
          answer: `${intent.name} is defined in ${defList}. No other files import from there.`,
          files: hits.map((h) => ({ path: h.file.path, reason: `defines ${intent.name}` })),
          symbols: hits.map(symOut),
        };
      }
      const list = [...impacted].sort();
      return {
        answer: `${intent.name} defined in ${defList}. Changing it impacts ${list.length} file(s):\n${list.map((f) => `  ${f}`).join("\n")}`,
        files: [...hits.map((h) => ({ path: h.file.path, reason: `defines ${intent.name}` })), ...list.map((f) => ({ path: f, reason: "imports from defining file" }))],
        symbols: hits.map(symOut),
      };
    }
    default: {
      const results = searchByTerms(index, intent.terms);
      if (results.length === 0) return { answer: `No files match terms: ${intent.terms.join(", ")}`, files: [], symbols: [] };
      return {
        answer: `${results.length} file(s) match:\n${results.map((r) => `  ${r.file.path} — ${r.reason}`).join("\n")}`,
        files: results.map((r) => ({ path: r.file.path, reason: r.reason })),
        symbols: [],
      };
    }
  }
}
