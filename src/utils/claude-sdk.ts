import { spawn } from "node:child_process";

/**
 * Spawns a Claude Code subagent to process a prompt.
 * Uses the Claude Code CLI with the --print flag to get output.
 */
export async function spawnClaudeAgent(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    // Use claude CLI with --print to get output without interactive mode
    const child = spawn("claude", ["--print", "-p", prompt], {
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 120000, // 2 minute timeout
    });

    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (data) => {
      stdout += data.toString();
    });

    child.stderr?.on("data", (data) => {
      stderr += data.toString();
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve(stdout.trim());
      } else {
        reject(new Error(`Claude agent failed with code ${code}: ${stderr}`));
      }
    });

    child.on("error", (error) => {
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
