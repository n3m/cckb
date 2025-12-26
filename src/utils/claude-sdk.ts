import { spawn } from "node:child_process";

export interface ClaudeAgentOptions {
  timeout?: number; // milliseconds, default 5 minutes
}

/**
 * Spawns a Claude Code subagent to process a prompt.
 * Uses the Claude Code CLI with the --print flag to get output.
 */
export async function spawnClaudeAgent(
  prompt: string,
  options?: ClaudeAgentOptions
): Promise<string> {
  const timeout = options?.timeout ?? 300000; // 5 minutes default

  return new Promise((resolve, reject) => {
    // Use claude CLI with --print to get output without interactive mode
    const child = spawn("claude", ["--print", "-p", prompt], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    // Manual timeout since spawn timeout doesn't always work
    const timeoutId = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      reject(new Error(`Claude agent timed out after ${timeout / 1000}s`));
    }, timeout);

    child.stdout?.on("data", (data) => {
      stdout += data.toString();
    });

    child.stderr?.on("data", (data) => {
      stderr += data.toString();
    });

    child.on("close", (code) => {
      clearTimeout(timeoutId);
      if (timedOut) return; // Already rejected

      if (code === 0) {
        resolve(stdout.trim());
      } else {
        reject(new Error(`Claude agent failed with code ${code}: ${stderr || "(no stderr)"}`));
      }
    });

    child.on("error", (error) => {
      clearTimeout(timeoutId);
      reject(error);
    });
  });
}

/**
 * Checks if Claude CLI is available.
 */
export async function isClaudeAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn("claude", ["--version"], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    child.on("close", (code) => {
      resolve(code === 0);
    });

    child.on("error", () => {
      resolve(false);
    });
  });
}
