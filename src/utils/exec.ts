import { spawn } from "node:child_process";

export interface ExecResult {
  success: boolean;
  stdout: string;
  stderr: string;
  code: number;
}

export interface ExecOptions {
  cwd?: string;
  signal?: AbortSignal;
  env?: Record<string, string>;
}

export async function execCommand(
  binary: string,
  args: string[],
  options?: ExecOptions,
): Promise<ExecResult> {
  return new Promise((hal) => {
    const child = spawn(binary, args, {
      cwd: options?.cwd,
      env: options?.env ? { ...process.env, ...options.env } : process.env,
      signal: options?.signal,
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d: Buffer) => {
      stdout += d.toString();
    });
    child.stderr.on("data", (d: Buffer) => {
      stderr += d.toString();
    });
    child.on("error", (err) => {
      hal({ success: false, stdout, stderr: String(err), code: 127 });
    });
    child.on("close", (code) => {
      hal({ success: code === 0, stdout, stderr, code: code ?? 1 });
    });
  });
}
