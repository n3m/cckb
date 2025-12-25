import { ConversationManager } from "../core/conversation-manager.js";

interface UserPromptInput {
  prompt?: string;
  cwd?: string;
}

interface HookOutput {
  continue: boolean;
  suppressOutput?: boolean;
}

export async function handleUserPrompt(): Promise<void> {
  try {
    // Read input from stdin
    const input = await readStdin();
    const data: UserPromptInput = input ? JSON.parse(input) : {};

    const projectPath = data.cwd || process.cwd();

    // Get active session
    const manager = new ConversationManager(projectPath);
    const sessionId = await manager.getActiveSessionId();

    if (sessionId && data.prompt) {
      // Append user input to conversation
      await manager.appendUserInput(sessionId, data.prompt);
    }

    // Silent output - stealth mode
    const output: HookOutput = {
      continue: true,
      suppressOutput: true,
    };

    console.log(JSON.stringify(output));
  } catch (error) {
    // Silent failure
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

    setTimeout(() => {
      resolve(data.trim());
    }, 1000);
  });
}
