/**
 * Type-safe symbol rename tool using ts-morph.
 *
 * Uses the TypeScript compiler (via ts-morph) to find all references
 * and rename them across all files. Same engine as VSCode's "Rename Symbol".
 *
 * Two modes for identifying which symbol to rename:
 *
 * 1. By name (for unique symbols):
 *    {"file": "src/daemon/arraf.ts", "old": "LLMIntent", "new": "NiyyaMustakhraja"}
 *    {"file": "src/daemon/arraf.ts", "old": "#pollPR", "new": "#raqabRisala"}
 *
 * 2. By position (for ambiguous names like "branch", "status", "message"):
 *    {"file": "src/daemon/hayat.ts", "line": 38, "col": 3, "new": "far"}
 *
 * Usage:
 *   deno run -A tools/rename.ts --batch renames.json
 *   deno run -A tools/rename.ts <file> <oldName> <newName>
 *   deno run -A tools/rename.ts <file> <line> <col> <newName>
 */

import { Project, Node, SyntaxKind, type SourceFile } from "npm:ts-morph@24.0.0";

const ROOT = new URL("../", import.meta.url).pathname.replace(/\/$/, "");

interface RenameByName {
  file: string;
  old: string;
  new: string;
}

interface RenameByPos {
  file: string;
  line: number;
  col: number;
  new: string;
}

type RenameSpec = RenameByName | RenameByPos;

function isPosBased(spec: RenameSpec): spec is RenameByPos {
  return "line" in spec && "col" in spec;
}

function createProject(): Project {
  return new Project({
    compilerOptions: {
      strict: true,
      noImplicitAny: true,
      allowJs: false,
      module: 99,
      target: 99,
      moduleResolution: 100,
    },
    skipAddingFilesFromTsConfig: true,
    skipFileDependencyResolution: true,
  });
}

function addSourceFiles(project: Project): void {
  for (const glob of [
    `${ROOT}/src/**/*.ts`,
    `${ROOT}/tests/**/*.ts`,
    `${ROOT}/db/**/*.ts`,
    `${ROOT}/plugins/**/*.ts`,
  ]) {
    project.addSourceFilesAtPaths(glob);
  }
}

function getSourceFile(project: Project, filePath: string): SourceFile | undefined {
  const absPath = filePath.startsWith("/") ? filePath : `${ROOT}/${filePath}`;
  return project.getSourceFile(absPath);
}

/**
 * Find a renameable node at a specific line:col position.
 * Walks up from the leaf node to find the declaration/signature that owns the name.
 */
function findNodeAtPosition(sf: SourceFile, line: number, col: number): Node | null {
  const pos = sf.compilerNode.getPositionOfLineAndCharacter(line - 1, col - 1);
  const node = sf.getDescendantAtPos(pos);
  if (!node) return null;

  /** If we landed on an identifier or private identifier, that's our target */
  if (Node.isIdentifier(node) || Node.isPrivateIdentifier(node)) {
    return node;
  }

  /** Walk children to find the identifier at this position */
  for (const child of node.getChildren()) {
    if ((Node.isIdentifier(child) || Node.isPrivateIdentifier(child)) &&
        child.getStart() <= pos && child.getEnd() >= pos) {
      return child;
    }
  }

  return node;
}

/**
 * Find a node by name in a source file.
 *
 * Priority order for disambiguation:
 * 1. Top-level declarations (interface, class, type, enum, function)
 * 2. Class private fields/methods (#name)
 * 3. Interface/class member declarations (property signatures, method signatures)
 * 4. Variable declarations
 * 5. First occurrence (fallback)
 */
function findNodeByName(sf: SourceFile, name: string): Node | null {
  const isPrivate = name.startsWith("#");

  if (isPrivate) {
    const searchText = name;
    const nodes = sf.getDescendantsOfKind(SyntaxKind.PrivateIdentifier)
      .filter(n => n.getText() === searchText);

    if (nodes.length === 0) return null;

    /** Prefer definitions over usages */
    for (const node of nodes) {
      const parent = node.getParent();
      if (parent && (
        Node.isPropertyDeclaration(parent) ||
        Node.isMethodDeclaration(parent) ||
        Node.isGetAccessorDeclaration(parent) ||
        Node.isSetAccessorDeclaration(parent)
      )) {
        return node;
      }
    }
    return nodes[0];
  }

  const nodes = sf.getDescendantsOfKind(SyntaxKind.Identifier)
    .filter(n => n.getText() === name);

  if (nodes.length === 0) return null;

  /** Priority 1: Top-level declarations */
  for (const node of nodes) {
    const parent = node.getParent();
    if (parent && (
      Node.isInterfaceDeclaration(parent) ||
      Node.isClassDeclaration(parent) ||
      Node.isTypeAliasDeclaration(parent) ||
      Node.isEnumDeclaration(parent) ||
      Node.isFunctionDeclaration(parent)
    )) {
      return node;
    }
  }

  /** Priority 2: Variable declarations (const, let) */
  for (const node of nodes) {
    const parent = node.getParent();
    if (parent && Node.isVariableDeclaration(parent)) {
      return node;
    }
  }

  /** Priority 3: Class member declarations */
  for (const node of nodes) {
    const parent = node.getParent();
    if (parent && (
      Node.isPropertyDeclaration(parent) ||
      Node.isMethodDeclaration(parent)
    )) {
      return node;
    }
  }

  /** Priority 4: Interface member signatures */
  for (const node of nodes) {
    const parent = node.getParent();
    if (parent && (
      Node.isPropertySignature(parent) ||
      Node.isMethodSignature(parent)
    )) {
      return node;
    }
  }

  /** Fallback: first occurrence */
  return nodes[0];
}

/**
 * Perform a rename using ts-morph's language service.
 *
 * This is the same engine that powers VSCode's "Rename Symbol".
 * It follows type references, handles re-exports, indexed access types, etc.
 */
function doRename(project: Project, spec: RenameSpec): { success: boolean; filesChanged: string[]; error?: string } {
  const sf = getSourceFile(project, spec.file);
  if (!sf) {
    return { success: false, filesChanged: [], error: `File not found: ${spec.file}` };
  }

  let node: Node | null;
  let label: string;

  if (isPosBased(spec)) {
    node = findNodeAtPosition(sf, spec.line, spec.col);
    label = `${spec.file}:${spec.line}:${spec.col}`;
  } else {
    node = findNodeByName(sf, spec.old);
    label = `${spec.file}:${spec.old}`;
  }

  if (!node) {
    return { success: false, filesChanged: [], error: `Symbol not found at ${label}` };
  }

  /** Determine the new name (strip # prefix - ts-morph handles it) */
  const isPrivate = Node.isPrivateIdentifier(node);
  let newName: string;
  if (isPosBased(spec)) {
    newName = spec.new.replace(/^#/, "");
  } else {
    newName = spec.new.replace(/^#/, "");
  }

  try {
    /** Try .rename() on the parent declaration node first - this is the cleanest path */
    const parent = node.getParent();
    if (parent && "rename" in parent && typeof (parent as Record<string, unknown>).rename === "function") {
      (parent as unknown as { rename(n: string): void }).rename(newName);
    } else {
      /** Fallback: use language service findRenameLocations */
      const locations = project.getLanguageService().findRenameLocations(node);

      /** Group by file, sort within each file by descending position */
      const byFile = new Map<string, typeof locations>();
      for (const loc of locations) {
        const fp = loc.getSourceFile().getFilePath();
        if (!byFile.has(fp)) byFile.set(fp, []);
        byFile.get(fp)!.push(loc);
      }

      const replaceName = isPrivate ? `#${newName}` : newName;

      for (const [, locs] of byFile) {
        locs.sort((a, b) => b.getTextSpan().getStart() - a.getTextSpan().getStart());
        for (const loc of locs) {
          const span = loc.getTextSpan();
          loc.getSourceFile().replaceText([span.getStart(), span.getEnd()], replaceName);
        }
      }
    }

    /** Collect which files were modified */
    const filesChanged = project.getSourceFiles()
      .filter(f => !f.isSaved())
      .map(f => f.getFilePath().replace(ROOT + "/", ""));

    return { success: true, filesChanged };
  } catch (e) {
    return { success: false, filesChanged: [], error: String(e) };
  }
}

async function main() {
  const args = Deno.args;
  let renames: RenameSpec[];

  if (args[0] === "--batch") {
    const batchFile = args[1];
    if (!batchFile) {
      console.error("Usage: rename.ts --batch <renames.json>");
      Deno.exit(1);
    }
    renames = JSON.parse(await Deno.readTextFile(batchFile));
  } else if (args.length === 4 && !isNaN(Number(args[1]))) {
    renames = [{ file: args[0], line: Number(args[1]), col: Number(args[2]), new: args[3] }];
  } else if (args.length === 3) {
    renames = [{ file: args[0], old: args[1], new: args[2] }];
  } else {
    console.error("Usage:");
    console.error("  rename.ts <file> <oldName> <newName>");
    console.error("  rename.ts <file> <line> <col> <newName>");
    console.error("  rename.ts --batch <renames.json>");
    Deno.exit(1);
  }

  console.log("Loading project...");
  const project = createProject();
  addSourceFiles(project);
  console.log(`Loaded ${project.getSourceFiles().length} files.\n`);

  let successes = 0;
  let failures = 0;

  for (const spec of renames) {
    const label = isPosBased(spec)
      ? `${spec.file}:${spec.line}:${spec.col} -> ${spec.new}`
      : `${spec.file}: ${spec.old} -> ${spec.new}`;

    const result = doRename(project, spec);

    if (result.success) {
      successes++;
      const files = result.filesChanged.length > 0
        ? ` (${result.filesChanged.join(", ")})`
        : "";
      console.log(`OK    ${label}${files}`);
    } else {
      failures++;
      console.error(`FAIL  ${label}`);
      console.error(`      ${result.error}`);
    }
  }

  const modified = project.getSourceFiles().filter(f => !f.isSaved());
  if (modified.length > 0) {
    console.log(`\nSaving ${modified.length} file(s)...`);
    await project.save();
  }

  console.log(`\nDone: ${successes} OK, ${failures} FAIL`);
  if (failures > 0) Deno.exit(1);
}

main();
