import * as fs from "node:fs/promises";
import * as path from "node:path";

export interface CCKBConfig {
  compaction: {
    trigger: "session_end" | "size" | "messages" | "manual";
    sizeThresholdKB: number;
    messageThreshold: number;
    cleanupAfterSummary: "keep" | "archive" | "delete";
  };
  capture: {
    tools: string[];
    maxContentLength: number;
  };
  vault: {
    autoIntegrate: boolean;
    maxDepth: number;
  };
  feedback: {
    enabled: boolean;
    contextDepth: number;
  };
}

export const DEFAULT_CONFIG: CCKBConfig = {
  compaction: {
    trigger: "session_end",
    sizeThresholdKB: 50,
    messageThreshold: 100,
    cleanupAfterSummary: "keep",
  },
  capture: {
    tools: ["Write", "Edit", "MultiEdit", "Bash", "Task"],
    maxContentLength: 500,
  },
  vault: {
    autoIntegrate: true,
    maxDepth: 5,
  },
  feedback: {
    enabled: true,
    contextDepth: 2,
  },
};

export async function loadConfig(projectPath: string): Promise<CCKBConfig> {
  const configPath = path.join(
    projectPath,
    "cc-knowledge-base",
    ".cckb-config.json"
  );

  try {
    const content = await fs.readFile(configPath, "utf-8");
    const userConfig = JSON.parse(content);
    return { ...DEFAULT_CONFIG, ...userConfig };
  } catch {
    return DEFAULT_CONFIG;
  }
}

export async function saveConfig(
  projectPath: string,
  config: CCKBConfig
): Promise<void> {
  const configPath = path.join(
    projectPath,
    "cc-knowledge-base",
    ".cckb-config.json"
  );

  await fs.writeFile(configPath, JSON.stringify(config, null, 2));
}

export function getKnowledgeBasePath(projectPath: string): string {
  return path.join(projectPath, "cc-knowledge-base");
}

export function getConversationsPath(projectPath: string): string {
  return path.join(projectPath, "cc-knowledge-base", "conversations");
}

export function getVaultPath(projectPath: string): string {
  return path.join(projectPath, "cc-knowledge-base", "vault");
}

export function getStatePath(projectPath: string): string {
  return path.join(projectPath, "cc-knowledge-base", ".cckb-state");
}
