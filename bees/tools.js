import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { serveForager } from "../hum/bee.js";
import { loadIndex } from "../codeintel/indexer.js";
import { queryIndex } from "../codeintel/query.js";

const pExecFile = promisify(execFile);

function repoOf(args) {
  return args.repo ?? process.env.IKSIR_REPO ?? process.cwd();
}

async function git(repo, argv) {
  const { stdout } = await pExecFile("git", argv, { cwd: repo });
  return stdout.trim();
}

export const TOOLS = [
  {
    name: "code_lookup",
    description: "where is a symbol defined. args: {query, repo?}",
    inputSchema: { type: "object", properties: { query: { type: "string" }, repo: { type: "string" } }, required: ["query"] },
    run: async (args) => queryIndex(await loadIndex(repoOf(args)), args.query).answer,
  },
  {
    name: "code_reverse_deps",
    description: "what depends on a file. args: {file, repo?}",
    inputSchema: { type: "object", properties: { file: { type: "string" }, repo: { type: "string" } }, required: ["file"] },
    run: async (args) => queryIndex(await loadIndex(repoOf(args)), `what depends on ${args.file}`).answer,
  },
  {
    name: "code_forward_deps",
    description: "what a file imports. args: {file, repo?}",
    inputSchema: { type: "object", properties: { file: { type: "string" }, repo: { type: "string" } }, required: ["file"] },
    run: async (args) => queryIndex(await loadIndex(repoOf(args)), `what does ${args.file} import`).answer,
  },
  {
    name: "code_exports",
    description: "symbols a file exports. args: {file, repo?}",
    inputSchema: { type: "object", properties: { file: { type: "string" }, repo: { type: "string" } }, required: ["file"] },
    run: async (args) => queryIndex(await loadIndex(repoOf(args)), `exports of ${args.file}`).answer,
  },
  {
    name: "code_impact",
    description: "impact of changing a symbol. args: {symbol, repo?}",
    inputSchema: { type: "object", properties: { symbol: { type: "string" }, repo: { type: "string" } }, required: ["symbol"] },
    run: async (args) => queryIndex(await loadIndex(repoOf(args)), `impact of changing ${args.symbol}`).answer,
  },
  {
    name: "code_search",
    description: "search files by terms. args: {terms, repo?}",
    inputSchema: { type: "object", properties: { terms: { type: "string" }, repo: { type: "string" } }, required: ["terms"] },
    run: async (args) => queryIndex(await loadIndex(repoOf(args)), args.terms).answer,
  },
  {
    name: "mur_far_list",
    description: "list vessels (git worktrees) of a repo. args: {repo?}",
    inputSchema: { type: "object", properties: { repo: { type: "string" } } },
    run: async (args) => {
      const out = await git(repoOf(args), ["worktree", "list", "--porcelain"]);
      if (!out) return "none";
      const vessels = [];
      for (const block of out.split("\n\n")) {
        const w = block.match(/^worktree (.+)$/m)?.[1] ?? "?";
        const b = block.match(/^branch refs\/heads\/(.+)$/m)?.[1] ?? "(detached)";
        const bare = /^bare$/m.test(block) ? " [bare]" : "";
        vessels.push(`${w} :: ${b}${bare}`);
      }
      return vessels.join("\n");
    },
  },
  {
    name: "mur_far_create",
    description: "open a vessel: worktree on a fresh branch. args: {name, base?, repo?}",
    inputSchema: { type: "object", properties: { name: { type: "string" }, base: { type: "string" }, repo: { type: "string" } }, required: ["name"] },
    run: async (args) => {
      const repo = repoOf(args);
      const base = args.base ?? (await git(repo, ["rev-parse", "--abbrev-ref", "HEAD"]));
      const path = `${repo}/../vessel-${args.name}`;
      await git(repo, ["worktree", "add", "-b", args.name, path, base]);
      return `${path} :: ${args.name} :: ${base}`;
    },
  },
  {
    name: "mur_far_status",
    description: "branch + dirty files per vessel. args: {repo?}",
    inputSchema: { type: "object", properties: { repo: { type: "string" } } },
    run: async (args) => {
      const repo = repoOf(args);
      const out = await git(repo, ["worktree", "list", "--porcelain"]);
      const lines = [];
      for (const block of out.split("\n\n")) {
        const w = block.match(/^worktree (.+)$/m)?.[1];
        if (!w || /^bare$/m.test(block)) continue;
        const b = block.match(/^branch refs\/heads\/(.+)$/m)?.[1] ?? "(detached)";
        let dirty = "";
        try {
          dirty = await git(w, ["status", "--porcelain"]);
        } catch {}
        lines.push(`${w} :: ${b} :: ${dirty ? `${dirty.split("\n").length}` : "clean"}`);
      }
      return lines.length > 0 ? lines.join("\n") : "none";
    },
  },
];

export async function dispatchTool(name, args) {
  const def = TOOLS.find((t) => t.name === name);
  if (!def) throw new Error(`unknown: ${name}`);
  return def.run(args ?? {});
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const bee = serveForager(
    {
      hive: "iksir-tools",
      prefix: "fbee",
      version: "1.0.0",
      tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
      provides: ["code-intel", "vessels"],
      propensity: { statefulness: "stateless", richness: "lean", wire: "iksir/tools" },
      source: "https://github.com/adiled/iksir",
      log: console.error,
    },
    dispatchTool,
  );
  bee.connect();
}
