/**
 * Code Intelligence — Data Model
 */

export interface CodeSymbol {
  name: string;
  kind: "function" | "class" | "type" | "interface" | "const" | "variable" | "enum" | "method";
  signature?: string;
  line: number;
  exported: boolean;
}

export interface FileEntry {
  path: string;
  hash: string;
  language: "typescript" | "python";
  symbols: CodeSymbol[];
  imports: string[];
}

export interface CodeIndex {
  version: 1;
  builtAt: string;
  repoPath: string;
  files: Record<string, FileEntry>;
}

export interface QueryResult {
  answer: string;
  files: { path: string; reason: string }[];
  symbols: { file: string; name: string; kind: string; signature?: string; line: number }[];
}
