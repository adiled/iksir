/**
 * Shell command execution utility.
 *
 * Single abstraction for running CLI tools (git, gh, curl, etc.).
 * Centralizes Deno.Command usage for testability — tests can mock
 * execCommand() instead of stubbing Deno.Command everywhere.
 */

export interface ExecResult {
  success: boolean;
  stdout: string;
  stderr: string;
  code: number;
}

export interface ExecOptions {
  /** Working directory for the command */
  cwd?: string;
  /** Abort signal to cancel the command */
  signal?: AbortSignal;
  /** Environment variables to pass to the command */
  env?: Record<string, string>;
}

/**
 * Execute a shell command and capture output.
 *
 * @param binary - The command to run (e.g., "git", "gh", "curl")
 * @param args - Arguments to pass to the command
 * @param options - Optional cwd, signal, env
 * @returns ExecResult with stdout, stderr, success, and exit code
 */
export async function execCommand(
  binary: string,
  args: string[],
  options?: ExecOptions,
): Promise<ExecResult> {
  const command = new Deno.Command(binary, {
    args,
    cwd: options?.cwd,
    stdout: "piped",
    stderr: "piped",
    signal: options?.signal,
    env: options?.env,
  });

  const process = await command.output();
  const stdout = new TextDecoder().decode(process.stdout);
  const stderr = new TextDecoder().decode(process.stderr);

  return {
    success: process.success,
    stdout,
    stderr,
    code: process.code,
  };
}
