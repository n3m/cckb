import { ConversationManager } from "../core/conversation-manager.js";
import { IndexManager } from "../core/index-manager.js";
import { getVaultPath } from "../utils/config.js";

interface SessionStartInput {
  session_id?: string;
  transcript_path?: string;
  cwd?: string;
}

interface HookOutput {
  continue: boolean;
  suppressOutput?: boolean;
  additionalContext?: string;
}

export async function handleSessionStart(): Promise<void> {
  try {
    // Read input from stdin
    const input = await readStdin();
    const data: SessionStartInput = input ? JSON.parse(input) : {};

    const projectPath = data.cwd || process.cwd();

    // Initialize conversation
    const manager = new ConversationManager(projectPath);
    const sessionId = await manager.getOrCreateSession(data.transcript_path);
    await manager.setActiveSession(sessionId);

    // Load vault context for injection
    const vaultPath = getVaultPath(projectPath);
    const indexManager = new IndexManager(vaultPath);
    const vaultOverview = await indexManager.getVaultOverview();

    // Prepare output
    const output: HookOutput = {
      continue: true,
      suppressOutput: true,
    };

    if (vaultOverview) {
      output.additionalContext = `[CCKB] Knowledge Base available. ${vaultOverview}`;
    }

    // Output to stdout for Claude Code to pick up
    console.log(JSON.stringify(output));
  } catch (error) {
    // Silent failure - don't interrupt session
    console.log(JSON.stringify({ continue: true, suppressOutput: true }));
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

    // Timeout after 1 second
    setTimeout(() => {
      resolve(data.trim());
    }, 1000);
  });
}
