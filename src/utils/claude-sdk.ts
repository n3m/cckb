import { spawn, type ChildProcess } from "node:child_process";

export interface ClaudeAgentOptions {
  timeout?: number; // milliseconds, default 5 minutes
  onProgress?: (event: ProgressEvent) => void; // Progress callback
  onStderr?: (data: string) => void; // Real-time stderr streaming
  verbose?: boolean; // Log all activity to stderr
}

export interface ProgressEvent {
  type: "started" | "activity" | "stdout" | "stderr" | "heartbeat" | "complete" | "error";
  message: string;
  timestamp: number;
  elapsed?: number; // ms since start
  bytesReceived?: number; // total bytes received so far
}

export interface ClaudeAgentHandle {
  promise: Promise<string>;
  process: ChildProcess;
  abort: () => void;
}

/**
 * Spawns a Claude Code subagent to process a prompt.
 * Uses the Claude Code CLI with the --print flag to get output.
 *
 * Returns a handle with:
 * - promise: The result promise
 * - process: The child process (for advanced control)
 * - abort: Function to cancel the operation
 */
export function spawnClaudeAgentWithHandle(
  prompt: string,
  options?: ClaudeAgentOptions
): ClaudeAgentHandle {
  const timeout = options?.timeout ?? 300000; // 5 minutes default
  const startTime = Date.now();
  let totalBytesReceived = 0;
  let lastActivityTime = startTime;
  let timedOut = false;
  let aborted = false;

  const emit = (event: Omit<ProgressEvent, "timestamp" | "elapsed">) => {
    if (options?.onProgress) {
      options.onProgress({
        ...event,
        timestamp: Date.now(),
        elapsed: Date.now() - startTime,
        bytesReceived: totalBytesReceived,
      });
    }
    if (options?.verbose) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.error(`[Claude SDK] [${elapsed}s] ${event.type}: ${event.message}`);
    }
  };

  // Use claude CLI with --print to get output without interactive mode
  const child = spawn("claude", ["--print", "-p", prompt], {
    stdio: ["pipe", "pipe", "pipe"],
  });

  emit({ type: "started", message: `Claude process spawned (PID: ${child.pid})` });

  // Heartbeat interval - shows we're still alive even with no output
  const heartbeatInterval = setInterval(() => {
    if (!timedOut && !aborted) {
      const silentFor = Date.now() - lastActivityTime;
      emit({
        type: "heartbeat",
        message: `Waiting for response... (silent for ${(silentFor / 1000).toFixed(0)}s)`
      });
    }
  }, 10000); // Every 10 seconds

  const promise = new Promise<string>((resolve, reject) => {
    let stdout = "";
    let stderr = "";

    // Manual timeout since spawn timeout doesn't always work
    const timeoutId = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      emit({ type: "error", message: `Timed out after ${timeout / 1000}s` });
      reject(new Error(`Claude agent timed out after ${timeout / 1000}s`));
    }, timeout);

    const cleanup = () => {
      clearTimeout(timeoutId);
      clearInterval(heartbeatInterval);
    };

    child.stdout?.on("data", (data) => {
      const chunk = data.toString();
      stdout += chunk;
      totalBytesReceived += data.length;
      lastActivityTime = Date.now();

      emit({
        type: "stdout",
        message: `Received ${data.length} bytes (total: ${totalBytesReceived})`
      });
    });

    child.stderr?.on("data", (data) => {
      const chunk = data.toString();
      stderr += chunk;
      totalBytesReceived += data.length;
      lastActivityTime = Date.now();

      // Stream stderr in real-time
      if (options?.onStderr) {
        options.onStderr(chunk);
      }

      emit({
        type: "stderr",
        message: chunk.trim().substring(0, 200) // First 200 chars
      });
    });

    child.on("close", (code) => {
      cleanup();
      if (timedOut || aborted) return;

      if (code === 0) {
        emit({
          type: "complete",
          message: `Success - received ${stdout.length} chars in ${((Date.now() - startTime) / 1000).toFixed(1)}s`
        });
        resolve(stdout.trim());
      } else {
        emit({ type: "error", message: `Exit code ${code}: ${stderr || "(no stderr)"}` });
        reject(new Error(`Claude agent failed with code ${code}: ${stderr || "(no stderr)"}`));
      }
    });

    child.on("error", (error) => {
      cleanup();
      emit({ type: "error", message: error.message });
      reject(error);
    });
  });

  const abort = () => {
    if (!timedOut && !aborted) {
      aborted = true;
      clearInterval(heartbeatInterval); // Clean up heartbeat on abort
      child.kill("SIGTERM");
      emit({ type: "error", message: "Aborted by user" });
    }
  };

  return { promise, process: child, abort };
}

/**
 * Spawns a Claude Code subagent to process a prompt.
 * Uses the Claude Code CLI with the --print flag to get output.
 *
 * This is the simple async version. For more control, use spawnClaudeAgentWithHandle.
 */
export async function spawnClaudeAgent(
  prompt: string,
  options?: ClaudeAgentOptions
): Promise<string> {
  const handle = spawnClaudeAgentWithHandle(prompt, options);
  return handle.promise;
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
