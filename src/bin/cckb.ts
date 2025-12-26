#!/usr/bin/env node

import { install } from "../cli/install.js";
import { discover } from "../cli/discover.js";

const args = process.argv.slice(2);
const command = args[0];

async function main() {
  switch (command) {
    case "init": {
      // Find target path (first arg that's not a flag)
      const targetPath = args.slice(1).find((a) => !a.startsWith("-")) || process.cwd();
      const force = args.includes("--force");
      const shouldDiscover = args.includes("--discover");

      await install(targetPath, { force });

      if (shouldDiscover) {
        console.log("\nRunning codebase discovery...\n");
        await discover({ targetPath, verbose: true });
      }
      break;
    }

    case "discover": {
      const targetPath = args.slice(1).find((a) => !a.startsWith("-")) || process.cwd();
      const verbose = args.includes("--verbose") || args.includes("-v");
      await discover({ targetPath, verbose: verbose || true });
      break;
    }

    case "hook":
      const hookName = args[1];
      await runHook(hookName);
      break;

    case "version":
    case "-v":
    case "--version":
      console.log("cckb v0.1.0");
      break;

    case "help":
    case "-h":
    case "--help":
    default:
      printHelp();
      break;
  }
}

async function runHook(hookName: string) {
  switch (hookName) {
    case "session-start": {
      const { handleSessionStart } = await import(
        "../hooks/session-start.js"
      );
      await handleSessionStart();
      break;
    }
    case "user-prompt": {
      const { handleUserPrompt } = await import("../hooks/user-prompt.js");
      await handleUserPrompt();
      break;
    }
    case "post-tool-use": {
      const { handlePostToolUse } = await import("../hooks/post-tool-use.js");
      await handlePostToolUse();
      break;
    }
    case "stop": {
      const { handleStop } = await import("../hooks/stop.js");
      await handleStop();
      break;
    }
    case "notification": {
      const { handleNotification } = await import("../hooks/notification.js");
      await handleNotification();
      break;
    }
    default:
      console.error(`Unknown hook: ${hookName}`);
      process.exit(1);
  }
}

function printHelp() {
  console.log(`
CCKB - Claude Code Knowledge Base

Usage:
  cckb init [path]           Install CCKB into a project
  cckb init --discover       Install and analyze existing codebase
  cckb discover [path]       Analyze codebase and populate vault
  cckb hook <name>           Run a specific hook (internal use)
  cckb version               Show version
  cckb help                  Show this help message

Options:
  --force                    Overwrite existing installation
  --discover                 Run codebase analysis after init
  --verbose, -v              Show detailed progress during discovery

Examples:
  cckb init                  Install in current directory
  cckb init ./myapp          Install in ./myapp directory
  cckb init --force          Reinstall, overwriting existing config
  cckb init --discover       Install and run initial discovery
  cckb discover              Analyze current project's codebase
  cckb discover ./myapp      Analyze ./myapp codebase
`);
}

main().catch((error) => {
  console.error("Error:", error.message);
  process.exit(1);
});
