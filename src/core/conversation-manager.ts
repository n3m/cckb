import * as path from "node:path";
import {
  ensureDir,
  fileExists,
  appendToFile,
  readTextFile,
  writeTextFile,
  readJSON,
  writeJSON,
  listDir,
  getFileSize,
  generateSessionId,
  getCurrentTimestamp,
} from "../utils/file-utils.js";
import {
  getConversationsPath,
  getStatePath,
  loadConfig,
} from "../utils/config.js";

export interface ConversationEntry {
  type: "USER" | "CLAUDE";
  timestamp: string;
  content: string;
  tool?: {
    name: string;
    action: string;
    target?: string;
  };
}

interface SessionState {
  sessionId: string;
  conversationPath: string;
  currentFileIndex: number;
  startedAt: string;
}

interface SessionMap {
  [transcriptPath: string]: SessionState;
}

export class ConversationManager {
  private projectPath: string;

  constructor(projectPath: string) {
    this.projectPath = projectPath;
  }

  async createConversation(sessionId: string): Promise<string> {
    const conversationsPath = getConversationsPath(this.projectPath);
    const conversationPath = path.join(conversationsPath, sessionId);

    await ensureDir(conversationPath);

    // Create initial file
    const initialFile = path.join(conversationPath, "0.txt");
    await writeTextFile(
      initialFile,
      `# Conversation: ${sessionId}\n# Started: ${getCurrentTimestamp()}\n\n`
    );

    // Update session state
    await this.updateSessionState({
      sessionId,
      conversationPath,
      currentFileIndex: 0,
      startedAt: getCurrentTimestamp(),
    });

    return conversationPath;
  }

  async appendUserInput(sessionId: string, prompt: string): Promise<void> {
    const state = await this.getSessionState(sessionId);
    if (!state) {
      throw new Error(`No session found for: ${sessionId}`);
    }

    const entry = this.formatEntry({
      type: "USER",
      timestamp: getCurrentTimestamp(),
      content: prompt,
    });

    const filePath = path.join(
      state.conversationPath,
      `${state.currentFileIndex}.txt`
    );
    await appendToFile(filePath, entry);

    // Check if we need to rotate
    await this.checkRotation(sessionId);
  }

  async appendClaudeOutput(
    sessionId: string,
    toolName: string,
    action: string,
    target?: string
  ): Promise<void> {
    const state = await this.getSessionState(sessionId);
    if (!state) {
      throw new Error(`No session found for: ${sessionId}`);
    }

    const entry = this.formatEntry({
      type: "CLAUDE",
      timestamp: getCurrentTimestamp(),
      content: action,
      tool: {
        name: toolName,
        action,
        target,
      },
    });

    const filePath = path.join(
      state.conversationPath,
      `${state.currentFileIndex}.txt`
    );
    await appendToFile(filePath, entry);
  }

  async getConversationFiles(sessionId: string): Promise<string[]> {
    const state = await this.getSessionState(sessionId);
    if (!state) {
      return [];
    }

    const files = await listDir(state.conversationPath);
    return files
      .filter((f) => f.endsWith(".txt"))
      .sort((a, b) => {
        const numA = parseInt(a.replace(".txt", ""), 10);
        const numB = parseInt(b.replace(".txt", ""), 10);
        return numA - numB;
      })
      .map((f) => path.join(state.conversationPath, f));
  }

  async getFullConversation(sessionId: string): Promise<string> {
    const files = await this.getConversationFiles(sessionId);
    const contents: string[] = [];

    for (const file of files) {
      const content = await readTextFile(file);
      if (content) {
        contents.push(content);
      }
    }

    return contents.join("\n\n---\n\n");
  }

  async rotateConversation(sessionId: string): Promise<void> {
    const state = await this.getSessionState(sessionId);
    if (!state) {
      throw new Error(`No session found for: ${sessionId}`);
    }

    const newIndex = state.currentFileIndex + 1;
    const newFile = path.join(state.conversationPath, `${newIndex}.txt`);

    await writeTextFile(
      newFile,
      `# Conversation: ${sessionId} (continued)\n# Compaction: ${newIndex}\n# Time: ${getCurrentTimestamp()}\n\n`
    );

    await this.updateSessionState({
      ...state,
      currentFileIndex: newIndex,
    });
  }

  async getOrCreateSession(transcriptPath?: string): Promise<string> {
    // Try to find existing session by transcript path
    if (transcriptPath) {
      const sessionMap = await this.loadSessionMap();
      const existing = sessionMap[transcriptPath];
      if (existing) {
        return existing.sessionId;
      }
    }

    // Create new session
    const sessionId = generateSessionId();
    await this.createConversation(sessionId);

    // Map transcript path to session if provided
    if (transcriptPath) {
      const sessionMap = await this.loadSessionMap();
      const state = await this.getSessionState(sessionId);
      if (state) {
        sessionMap[transcriptPath] = state;
        await this.saveSessionMap(sessionMap);
      }
    }

    return sessionId;
  }

  async getActiveSessionId(): Promise<string | null> {
    const statePath = getStatePath(this.projectPath);
    const activeSessionFile = path.join(statePath, "active-session.json");

    const data = await readJSON<{ sessionId: string }>(activeSessionFile);
    return data?.sessionId || null;
  }

  async setActiveSession(sessionId: string): Promise<void> {
    const statePath = getStatePath(this.projectPath);
    const activeSessionFile = path.join(statePath, "active-session.json");

    await ensureDir(statePath);
    await writeJSON(activeSessionFile, { sessionId });
  }

  private async checkRotation(sessionId: string): Promise<void> {
    const config = await loadConfig(this.projectPath);
    const state = await this.getSessionState(sessionId);
    if (!state) return;

    const currentFile = path.join(
      state.conversationPath,
      `${state.currentFileIndex}.txt`
    );
    const size = await getFileSize(currentFile);

    const thresholdBytes = config.compaction.sizeThresholdKB * 1024;

    if (size >= thresholdBytes) {
      await this.rotateConversation(sessionId);
    }
  }

  private formatEntry(entry: ConversationEntry): string {
    let content = `[${entry.type}][${entry.timestamp}]`;

    if (entry.tool) {
      content += `[TOOL:${entry.tool.name}]`;
    }

    content += `\n${entry.content}\n---\n\n`;

    return content;
  }

  private async getSessionState(
    sessionId: string
  ): Promise<SessionState | null> {
    const sessionMap = await this.loadSessionMap();

    for (const state of Object.values(sessionMap)) {
      if (state.sessionId === sessionId) {
        return state;
      }
    }

    // Try to find by looking at conversations directory
    const conversationsPath = getConversationsPath(this.projectPath);
    const conversationPath = path.join(conversationsPath, sessionId);

    if (await fileExists(conversationPath)) {
      // Reconstruct state
      const files = await listDir(conversationPath);
      const txtFiles = files.filter((f) => f.endsWith(".txt"));
      const maxIndex = Math.max(
        ...txtFiles.map((f) => parseInt(f.replace(".txt", ""), 10))
      );

      return {
        sessionId,
        conversationPath,
        currentFileIndex: maxIndex >= 0 ? maxIndex : 0,
        startedAt: getCurrentTimestamp(),
      };
    }

    return null;
  }

  private async updateSessionState(state: SessionState): Promise<void> {
    const sessionMap = await this.loadSessionMap();

    // Find and update or add
    let found = false;
    for (const [key, existing] of Object.entries(sessionMap)) {
      if (existing.sessionId === state.sessionId) {
        sessionMap[key] = state;
        found = true;
        break;
      }
    }

    if (!found) {
      sessionMap[state.conversationPath] = state;
    }

    await this.saveSessionMap(sessionMap);
  }

  private async loadSessionMap(): Promise<SessionMap> {
    const statePath = getStatePath(this.projectPath);
    const mapPath = path.join(statePath, "session-map.json");

    return (await readJSON<SessionMap>(mapPath)) || {};
  }

  private async saveSessionMap(map: SessionMap): Promise<void> {
    const statePath = getStatePath(this.projectPath);
    const mapPath = path.join(statePath, "session-map.json");

    await ensureDir(statePath);
    await writeJSON(mapPath, map);
  }
}
