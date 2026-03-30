/**
 * Istakhraj (استخراج) — Runūz Extractor
 *
 * Uses the TypeScript AST to extract all named runūz (symbols) from source files:
 * classes, interfaces, type aliases, enums, functions, methods, properties,
 * getters/setters, and interface members.
 *
 * Does NOT judge language — it extracts. You analyze.
 *
 * Excludes:
 * - Local variables (not runūz)
 * - Parameters (not runūz)
 * - Import specifiers (upstream names, not ours)
 *
 * Usage:
 *   deno run -A tools/istakhraj.ts <file>   # extract from one file
 *   deno run -A tools/istakhraj.ts          # extract from all src files
 */

import {
  Project,
  Node,
  type SourceFile,
} from "npm:ts-morph@24.0.0";

const ROOT = "/root/herald";

interface Rune {
  file: string;
  line: number;
  col: number;
  name: string;
  kind: string;
}

function extractRunuz(sf: SourceFile): Rune[] {
  const runuz: Rune[] = [];
  const filePath = sf.getFilePath().replace(ROOT + "/", "");

  function record(node: Node, name: string, kind: string) {
    const { line, column } = sf.getLineAndColumnAtPos(node.getStart());
    runuz.push({ file: filePath, line, col: column, name, kind });
  }

  sf.forEachDescendant((node) => {
    if (Node.isClassDeclaration(node) || Node.isClassExpression(node)) {
      const nameNode = node.getNameNode();
      if (nameNode) record(nameNode, nameNode.getText(), "class");
    } else if (Node.isInterfaceDeclaration(node)) {
      record(node.getNameNode(), node.getName(), "interface");
    } else if (Node.isTypeAliasDeclaration(node)) {
      record(node.getNameNode(), node.getName(), "type");
    } else if (Node.isEnumDeclaration(node)) {
      record(node.getNameNode(), node.getName(), "enum");
    } else if (Node.isFunctionDeclaration(node)) {
      const nameNode = node.getNameNode();
      if (nameNode) record(nameNode, node.getName()!, "function");
    } else if (Node.isMethodDeclaration(node)) {
      const nameNode = node.getNameNode();
      if (nameNode) record(nameNode, nameNode.getText(), "method");
    } else if (Node.isMethodSignature(node)) {
      const nameNode = node.getNameNode();
      if (nameNode) record(nameNode, nameNode.getText(), "method-sig");
    } else if (Node.isPropertyDeclaration(node)) {
      const nameNode = node.getNameNode();
      if (nameNode) record(nameNode, nameNode.getText(), "property");
    } else if (Node.isPropertySignature(node)) {
      const nameNode = node.getNameNode();
      if (nameNode) record(nameNode, nameNode.getText(), "prop-sig");
    } else if (Node.isGetAccessorDeclaration(node)) {
      const nameNode = node.getNameNode();
      if (nameNode) record(nameNode, nameNode.getText(), "getter");
    } else if (Node.isSetAccessorDeclaration(node)) {
      const nameNode = node.getNameNode();
      if (nameNode) record(nameNode, nameNode.getText(), "setter");
    }
  });

  return runuz;
}

async function main() {
  const targetFile = Deno.args[0];

  const project = new Project({
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

  if (targetFile) {
    const abs = targetFile.startsWith("/") ? targetFile : `${ROOT}/${targetFile}`;
    project.addSourceFileAtPath(abs);
  } else {
    for (const glob of [
      `${ROOT}/src/**/*.ts`,
      `${ROOT}/tests/**/*.ts`,
      `${ROOT}/db/**/*.ts`,
      `${ROOT}/plugins/**/*.ts`,
    ]) {
      project.addSourceFilesAtPaths(glob);
    }
  }

  for (const sf of project.getSourceFiles()) {
    const runuz = extractRunuz(sf);
    if (runuz.length === 0) continue;

    const filePath = sf.getFilePath().replace(ROOT + "/", "");
    console.log(`\n${filePath}:`);
    for (const r of runuz) {
      console.log(`  ${String(r.line).padStart(4)}:${String(r.col).padEnd(4)} ${r.kind.padEnd(12)} ${r.name}`);
    }
  }
}

main();
