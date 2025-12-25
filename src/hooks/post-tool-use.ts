import { ConversationManager } from "../core/conversation-manager.js";
import { loadConfig } from "../utils/config.js";

interface ToolInput {
  file_path?: string;
  command?: string;
  content?: string;
  old_string?: string;
  new_string?: string;
  prompt?: string;
}

interface PostToolUseInput {
  tool_name?: string;
  tool_input?: ToolInput;
  tool_response?: unknown;
  cwd?: string;
}

interface HookOutput {
  continue: boolean;
  suppressOutput?: boolean;
}

export async function handlePostToolUse(): Promise<void> {
  try {
    // Read input from stdin
    const input = await readStdin();
    const data: PostToolUseInput = input ? JSON.parse(input) : {};

    const projectPath = data.cwd || process.cwd();
    const config = await loadConfig(projectPath);

    // Check if this tool should be captured
    const toolName = data.tool_name || "";
    if (!config.capture.tools.includes(toolName)) {
      console.log(JSON.stringify({ continue: true, suppressOutput: true }));
      return;
    }

    // Get active session
    const manager = new ConversationManager(projectPath);
    const sessionId = await manager.getActiveSessionId();

    if (sessionId && data.tool_input) {
      // Format action based on tool type
      const { action, target } = formatToolAction(
        toolName,
        data.tool_input,
        config.capture.maxContentLength
      );

      if (action) {
        await manager.appendClaudeOutput(sessionId, toolName, action, target);
      }
    }

    // Silent output
    const output: HookOutput = {
      continue: true,
      suppressOutput: true,
    };

    console.log(JSON.stringify(output));
  } catch (error) {
    console.log(JSON.stringify({ continue: true, suppressOutput: true }));
  }
}

function formatToolAction(
  toolName: string,
  input: ToolInput,
  maxLength: number
): { action: string; target?: string } {
  switch (toolName) {
    case "Write":
      return {
        action: `Created file: ${input.file_path}`,
        target: input.file_path,
      };

    case "Edit":
    case "MultiEdit":
      return {
        action: `Modified file: ${input.file_path}`,
        target: input.file_path,
      };

    case "Bash": {
      const cmd = input.command || "";
      const truncated =
        cmd.length > maxLength ? cmd.substring(0, maxLength) + "..." : cmd;
      return {
        action: `Executed: ${truncated}`,
      };
    }

    case "Task": {
      const prompt = input.prompt || "";
      const truncated =
        prompt.length > maxLength
          ? prompt.substring(0, maxLength) + "..."
          : prompt;
      return {
        action: `Spawned agent: ${truncated}`,
      };
    }

    default:
      return {
        action: `Used tool: ${toolName}`,
      };
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
