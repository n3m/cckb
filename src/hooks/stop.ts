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

    // Log to stderr for debugging (stdout is for hook protocol)
    console.error(`[CCKB] Stop hook triggered for: ${projectPath}`);

    // Get active session
    const manager = new ConversationManager(projectPath);
    const sessionId = await manager.getActiveSessionId();

    if (!sessionId) {
      console.error("[CCKB] No active session found, skipping compaction");
      console.log(JSON.stringify({ continue: true, suppressOutput: true }));
      return;
    }

    console.error(`[CCKB] Starting compaction for session: ${sessionId}`);

    // Run compaction and wait for it to complete before exiting
    try {
      await runCompactionAsync(projectPath, sessionId);
      console.error("[CCKB] Compaction complete");
    } catch (error) {
      console.error("[CCKB] Compaction failed:", error);
    }

    const output: HookOutput = {
      continue: true,
      suppressOutput: true,
    };

    console.log(JSON.stringify(output));
  } catch (error) {
    console.error("[CCKB] Stop hook error:", error);
    console.log(JSON.stringify({ continue: true, suppressOutput: true }));
  }
}

async function runCompactionAsync(
  projectPath: string,
  sessionId: string
): Promise<void> {
  try {
    const config = await loadConfig(projectPath);

    if (config.compaction.trigger !== "session_end") {
      console.error(`[CCKB] Skipping - trigger is "${config.compaction.trigger}"`);
      return;
    }

    const manager = new ConversationManager(projectPath);
    const conversation = await manager.getFullConversation(sessionId);

    if (!conversation || conversation.length < 100) {
      console.error(`[CCKB] Skipping - conversation too short (${conversation?.length || 0} chars)`);
      return;
    }

    console.error(`[CCKB] Compacting ${conversation.length} chars...`);

    const compactionEngine = new CompactionEngine(projectPath);
    const summary = await compactionEngine.compact(sessionId, conversation);

    if (!summary) {
      console.error("[CCKB] Compaction returned null");
      return;
    }

    console.error(`[CCKB] Summary created: ${summary.entities.length} entities`);

    if (config.vault.autoIntegrate) {
      const vaultPath = getVaultPath(projectPath);
      const integrator = new VaultIntegrator(vaultPath);
      await integrator.integrate(summary);
      console.error("[CCKB] Vault updated");
    }
  } catch (error) {
    console.error("[CCKB] runCompactionAsync error:", error);
    throw error;
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
