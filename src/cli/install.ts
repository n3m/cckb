import * as fs from "node:fs/promises";
import * as fsSync from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ensureDir,
  fileExists,
  readJSON,
  writeJSON,
  readTextFile,
  writeTextFile,
} from "../utils/file-utils.js";
import { DEFAULT_CONFIG } from "../utils/config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Find package root by looking for package.json
function findPackageRoot(): string {
  let dir = __dirname;
  for (let i = 0; i < 5; i++) {
    const packageJson = path.join(dir, "package.json");
    if (fsSync.existsSync(packageJson)) {
      return dir;
    }
    dir = path.dirname(dir);
  }
  // Fallback to relative from __dirname
  return path.resolve(__dirname, "../..");
}

const PACKAGE_ROOT = findPackageRoot();
const TEMPLATES_DIR = path.join(PACKAGE_ROOT, "templates");

export interface InstallOptions {
  force?: boolean;
}

export async function install(
  targetPath: string,
  options: InstallOptions = {}
): Promise<void> {
  const resolvedPath = path.resolve(targetPath);

  console.log(`Installing CCKB to: ${resolvedPath}`);

  // Pre-flight checks
  await validateTargetPath(resolvedPath);
  await checkExistingInstallation(resolvedPath, options.force);

  // Create directory structure
  await createDirectoryStructure(resolvedPath);

  // Copy template files
  await copyTemplateFiles(resolvedPath);

  // Create config file
  await createConfigFile(resolvedPath);

  // Install hooks configuration
  await installHooks(resolvedPath);

  // Update CLAUDE.md
  await updateClaudeMd(resolvedPath);

  // Update .gitignore
  await updateGitignore(resolvedPath);

  console.log("\nCCKB installed successfully!");
  console.log("\nNext steps:");
  console.log("  1. Review cc-knowledge-base/vault/ structure");
  console.log("  2. Check .claude/settings.json for hook configuration");
  console.log("  3. Start a new Claude Code session to begin capturing knowledge");
}

async function validateTargetPath(targetPath: string): Promise<void> {
  const exists = await fileExists(targetPath);
  if (!exists) {
    throw new Error(`Target path does not exist: ${targetPath}`);
  }

  const stats = await fs.stat(targetPath);
  if (!stats.isDirectory()) {
    throw new Error(`Target path is not a directory: ${targetPath}`);
  }
}

async function checkExistingInstallation(
  targetPath: string,
  force?: boolean
): Promise<void> {
  const kbPath = path.join(targetPath, "cc-knowledge-base");
  const exists = await fileExists(kbPath);

  if (exists && !force) {
    throw new Error(
      "CCKB is already installed in this project. Use --force to reinstall."
    );
  }
}

async function createDirectoryStructure(targetPath: string): Promise<void> {
  const directories = [
    "cc-knowledge-base",
    "cc-knowledge-base/conversations",
    "cc-knowledge-base/vault",
    "cc-knowledge-base/vault/entities",
    "cc-knowledge-base/vault/apps",
    "cc-knowledge-base/vault/modules",
    "cc-knowledge-base/.cckb-state",
  ];

  for (const dir of directories) {
    await ensureDir(path.join(targetPath, dir));
  }

  console.log("  Created directory structure");
}

async function copyTemplateFiles(targetPath: string): Promise<void> {
  const vaultFiles = [
    { src: "vault/INDEX.md", dest: "cc-knowledge-base/vault/INDEX.md" },
    {
      src: "vault/architecture.md",
      dest: "cc-knowledge-base/vault/architecture.md",
    },
    {
      src: "vault/general-knowledge.md",
      dest: "cc-knowledge-base/vault/general-knowledge.md",
    },
    {
      src: "vault/entities/INDEX.md",
      dest: "cc-knowledge-base/vault/entities/INDEX.md",
    },
    {
      src: "vault/apps/INDEX.md",
      dest: "cc-knowledge-base/vault/apps/INDEX.md",
    },
    {
      src: "vault/modules/INDEX.md",
      dest: "cc-knowledge-base/vault/modules/INDEX.md",
    },
  ];

  for (const file of vaultFiles) {
    const srcPath = path.join(TEMPLATES_DIR, file.src);
    const destPath = path.join(targetPath, file.dest);

    const content = await readTextFile(srcPath);
    if (content) {
      await writeTextFile(destPath, content);
    }
  }

  // Create .gitkeep for conversations
  await writeTextFile(
    path.join(targetPath, "cc-knowledge-base/conversations/.gitkeep"),
    ""
  );

  console.log("  Copied vault template files");
}

async function createConfigFile(targetPath: string): Promise<void> {
  const configPath = path.join(
    targetPath,
    "cc-knowledge-base",
    ".cckb-config.json"
  );

  await writeJSON(configPath, DEFAULT_CONFIG);

  console.log("  Created configuration file");
}

async function installHooks(targetPath: string): Promise<void> {
  const claudeDir = path.join(targetPath, ".claude");
  const settingsPath = path.join(claudeDir, "settings.json");

  await ensureDir(claudeDir);

  // Load existing settings or create new
  let settings: Record<string, unknown> =
    (await readJSON<Record<string, unknown>>(settingsPath)) || {};

  // Load hook template
  const templatePath = path.join(TEMPLATES_DIR, "settings.json.tmpl");
  const hookSettings = await readJSON<{ hooks: Record<string, unknown> }>(
    templatePath
  );

  if (!hookSettings) {
    throw new Error("Failed to load hook template");
  }

  // Merge hooks (CCKB hooks take precedence for its own hook types)
  const existingHooks = (settings.hooks as Record<string, unknown[]>) || {};
  const newHooks = hookSettings.hooks as Record<string, unknown[]>;

  settings.hooks = mergeHooks(existingHooks, newHooks);

  await writeJSON(settingsPath, settings);

  console.log("  Installed hook configuration");
}

function mergeHooks(
  existing: Record<string, unknown[]>,
  incoming: Record<string, unknown[]>
): Record<string, unknown[]> {
  const merged = { ...existing };

  for (const [hookType, hooks] of Object.entries(incoming)) {
    if (!merged[hookType]) {
      merged[hookType] = [];
    }

    // Add incoming hooks, avoiding duplicates based on command
    for (const hook of hooks) {
      const hookObj = hook as Record<string, unknown>;
      const command = hookObj.command as string | undefined;

      if (command?.includes("cckb")) {
        // Remove any existing CCKB hooks for this type
        merged[hookType] = merged[hookType].filter((h) => {
          const existingCmd = (h as Record<string, unknown>).command as
            | string
            | undefined;
          return !existingCmd?.includes("cckb");
        });
      }

      merged[hookType].push(hook);
    }
  }

  return merged;
}

async function updateClaudeMd(targetPath: string): Promise<void> {
  const claudeMdPath = path.join(targetPath, "CLAUDE.md");
  const templatePath = path.join(TEMPLATES_DIR, "CLAUDE.md.tmpl");

  const template = await readTextFile(templatePath);
  if (!template) {
    throw new Error("Failed to load CLAUDE.md template");
  }

  const marker = "## Project Knowledge Base (CCKB)";

  let existing = await readTextFile(claudeMdPath);

  if (existing) {
    // Check if CCKB section already exists
    if (existing.includes(marker)) {
      // Replace existing CCKB section
      const regex = /## Project Knowledge Base \(CCKB\)[\s\S]*?(?=\n## |$)/;
      existing = existing.replace(regex, template.trim());
    } else {
      // Append CCKB section
      existing = existing.trimEnd() + "\n\n" + template;
    }
    await writeTextFile(claudeMdPath, existing);
  } else {
    // Create new CLAUDE.md with CCKB section
    await writeTextFile(claudeMdPath, template);
  }

  console.log("  Updated CLAUDE.md with vault directives");
}

async function updateGitignore(targetPath: string): Promise<void> {
  const gitignorePath = path.join(targetPath, ".gitignore");

  const entries = [
    "",
    "# CCKB state files",
    "cc-knowledge-base/.cckb-state/",
  ];

  let existing = (await readTextFile(gitignorePath)) || "";

  // Check if already added
  if (existing.includes("cc-knowledge-base/.cckb-state/")) {
    return;
  }

  existing = existing.trimEnd() + "\n" + entries.join("\n") + "\n";
  await writeTextFile(gitignorePath, existing);

  console.log("  Updated .gitignore");
}
