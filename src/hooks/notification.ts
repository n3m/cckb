import { IndexManager } from "../core/index-manager.js";
import { loadConfig, getVaultPath, getStatePath } from "../utils/config.js";
import { readJSON, writeJSON, fileExists } from "../utils/file-utils.js";
import * as path from "node:path";

interface NotificationInput {
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  cwd?: string;
}

interface VaultCache {
  overview: string;
  entities: string[];
  lastUpdated: string;
}

interface HookOutput {
  continue: boolean;
  suppressOutput?: boolean;
  additionalContext?: string;
}

export async function handleNotification(): Promise<void> {
  try {
    // Read input from stdin
    const input = await readStdin();
    const data: NotificationInput = input ? JSON.parse(input) : {};

    const projectPath = data.cwd || process.cwd();
    const config = await loadConfig(projectPath);

    if (!config.feedback.enabled) {
      console.log(JSON.stringify({ continue: true, suppressOutput: true }));
      return;
    }

    // Get relevant context from vault cache
    const context = await getRelevantContext(projectPath, data);

    const output: HookOutput = {
      continue: true,
      suppressOutput: true,
    };

    if (context) {
      output.additionalContext = context;
    }

    console.log(JSON.stringify(output));
  } catch (error) {
    console.log(JSON.stringify({ continue: true, suppressOutput: true }));
  }
}

async function getRelevantContext(
  projectPath: string,
  input: NotificationInput
): Promise<string | null> {
  // Load or refresh vault cache
  const cache = await loadVaultCache(projectPath);

  if (!cache) {
    return null;
  }

  // Analyze input for relevant keywords
  const keywords = extractKeywords(input);

  if (keywords.length === 0) {
    return null;
  }

  // Find matching entities
  const matches = cache.entities.filter((entity) =>
    keywords.some(
      (keyword) =>
        entity.toLowerCase().includes(keyword.toLowerCase()) ||
        keyword.toLowerCase().includes(entity.toLowerCase())
    )
  );

  if (matches.length === 0) {
    return null;
  }

  return `[CCKB] Related vault knowledge: ${matches.join(", ")}. Check vault/entities/ for details.`;
}

function extractKeywords(input: NotificationInput): string[] {
  const keywords: string[] = [];

  if (input.tool_input) {
    // Extract from file paths
    if (typeof input.tool_input.file_path === "string") {
      const parts = input.tool_input.file_path.split("/");
      keywords.push(...parts.filter((p) => p.length > 2));
    }

    // Extract from content (first 500 chars)
    if (typeof input.tool_input.content === "string") {
      const content = input.tool_input.content.substring(0, 500);
      // Find potential entity names (PascalCase or camelCase words)
      const matches = content.match(/[A-Z][a-z]+(?:[A-Z][a-z]+)*/g);
      if (matches) {
        keywords.push(...matches);
      }
    }

    // Extract from command
    if (typeof input.tool_input.command === "string") {
      const cmd = input.tool_input.command;
      // Extract file paths from command
      const pathMatches = cmd.match(/[\w./]+\.ts|[\w./]+\.js|[\w./]+\.tsx/g);
      if (pathMatches) {
        keywords.push(...pathMatches);
      }
    }
  }

  return [...new Set(keywords)];
}

async function loadVaultCache(projectPath: string): Promise<VaultCache | null> {
  const statePath = getStatePath(projectPath);
  const cachePath = path.join(statePath, "vault-cache.json");

  // Check if cache exists and is fresh (5 minutes)
  if (await fileExists(cachePath)) {
    const cache = await readJSON<VaultCache>(cachePath);
    if (cache) {
      const cacheAge = Date.now() - new Date(cache.lastUpdated).getTime();
      const maxAge = 5 * 60 * 1000; // 5 minutes

      if (cacheAge < maxAge) {
        return cache;
      }
    }
  }

  // Refresh cache
  try {
    const vaultPath = getVaultPath(projectPath);
    const indexManager = new IndexManager(vaultPath);

    const overview = await indexManager.getVaultOverview();
    const entities = await indexManager.listEntities();

    const cache: VaultCache = {
      overview: overview || "",
      entities,
      lastUpdated: new Date().toISOString(),
    };

    await writeJSON(cachePath, cache);
    return cache;
  } catch {
    return null;
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
