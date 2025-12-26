import * as path from "node:path";
import { fileExists } from "../utils/file-utils.js";
import { AutoDiscover } from "../core/auto-discover.js";

export interface DiscoverCommandOptions {
  targetPath?: string;
  verbose?: boolean;
}

export async function discover(options: DiscoverCommandOptions = {}): Promise<void> {
  const targetPath = path.resolve(options.targetPath || process.cwd());
  const verbose = options.verbose ?? true; // Default to verbose for CLI

  // Validate target path
  const exists = await fileExists(targetPath);
  if (!exists) {
    console.error(`Error: Target path does not exist: ${targetPath}`);
    process.exit(1);
  }

  // Check if CCKB is installed
  const kbPath = path.join(targetPath, "cc-knowledge-base");
  const kbExists = await fileExists(kbPath);
  if (!kbExists) {
    console.error("Error: CCKB is not installed in this project.");
    console.error("Run 'cckb init' first to install CCKB.");
    process.exit(1);
  }

  try {
    const autoDiscover = new AutoDiscover(targetPath, verbose);
    const result = await autoDiscover.discover();

    if (!result.integrated) {
      console.error("\nWarning: Vault integration failed. Check the logs above.");
      process.exit(1);
    }

    console.log(`\nVault populated at: ${kbPath}/vault/`);
  } catch (error) {
    console.error("Discovery failed:", error);
    process.exit(1);
  }
}
