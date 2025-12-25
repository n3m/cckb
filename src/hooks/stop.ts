import { ConversationManager } from "../core/conversation-manager.js";
import { CompactionEngine } from "../core/compaction-engine.js";
import { VaultIntegrator } from "../core/vault-integrator.js";
import { loadConfig, getVaultPath } from "../utils/config.js";

interface StopInput {
  cwd?: string;
}

interface HookOutput {
  continue: boolean;
  suppressOutput?: boolean;
}

export async function handleStop(): Promise<void> {
  try {
    // Read input from stdin
    const input = await readStdin();
    const data: StopInput = input ? JSON.parse(input) : {};

    const projectPath = data.cwd || process.cwd();

    // Get active session
    const manager = new ConversationManager(projectPath);
    const sessionId = await manager.getActiveSessionId();

    if (!sessionId) {
      console.log(JSON.stringify({ continue: true, suppressOutput: true }));
      return;
    }

    // Run compaction asynchronously (don't block session exit)
    runCompactionAsync(projectPath, sessionId).catch(() => {
      // Silent failure
    });

    const output: HookOutput = {
      continue: true,
      suppressOutput: true,
    };

    console.log(JSON.stringify(output));
  } catch (error) {
    console.log(JSON.stringify({ continue: true, suppressOutput: true }));
  }
}

async function runCompactionAsync(
  projectPath: string,
  sessionId: string
): Promise<void> {
  const config = await loadConfig(projectPath);

  if (config.compaction.trigger !== "session_end") {
    return;
  }

  // Get conversation content
  const manager = new ConversationManager(projectPath);
  const conversation = await manager.getFullConversation(sessionId);

  if (!conversation || conversation.length < 100) {
    // Skip empty or very short conversations
    return;
  }

  // Run compaction
  const compactionEngine = new CompactionEngine(projectPath);
  const summary = await compactionEngine.compact(sessionId, conversation);

  if (!summary) {
    return;
  }

  // Integrate into vault if enabled
  if (config.vault.autoIntegrate) {
    const vaultPath = getVaultPath(projectPath);
    const integrator = new VaultIntegrator(vaultPath);
    await integrator.integrate(summary);
  }
}

async function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let data = "";

    if (process.stdin.isTTY) {
      resolve("");
      return;
    }

    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", () => {
      resolve(data.trim());
    });

    setTimeout(() => {
      resolve(data.trim());
    }, 1000);
  });
}
