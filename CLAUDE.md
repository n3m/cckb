# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

CCKB (Claude Code Knowledge Base) is a TypeScript CLI tool that automatically captures Claude Code conversations and builds a structured knowledge base. It runs as background hooks during Claude Code sessions, silently capturing context and organizing it into a vault that Claude can reference in future sessions.

**Key Principle**: Stealth operation - no user interaction required. Claude builds its own project knowledge base while the user focuses on their actual work.

### Product Vision

The system captures conversations automatically during development, summarizes them on session end using Claude SDK, and integrates the extracted knowledge into a hierarchical vault. Future sessions receive relevant context from the vault via hooks, enabling Claude to make better decisions based on project history.

## Build & Development Commands

```bash
npm run build        # Build with tsup (outputs to dist/)
npm run dev          # Watch mode build
npm run typecheck    # Type checking without emit
npm run test         # Run tests with vitest
```

### Testing Locally

```bash
# Test the CLI
node dist/bin/cckb.js init /tmp/test-project

# Test bash installer
./scripts/install.sh /tmp/test-project
```

### Publishing

```bash
npm version patch    # Bump version (0.1.2 → 0.1.3)
npm publish          # Publish to npm (runs prepublishOnly → build)
git push origin master --tags
```

## Architecture

### The Cycle

```
Capture → Compact → Integrate → Feedback
   ↑                              ↓
   └──────── Next Session ────────┘
```

1. **Capture** - Hooks silently log user prompts and Claude's tool outputs
2. **Compact** - On session end, conversations are summarized via Claude SDK
3. **Integrate** - Entities, patterns, and knowledge are extracted and organized into vault
4. **Feedback** - Future sessions receive relevant context from vault via PreToolUse hook

### Package Structure

```
cckb/
├── package.json                 # npm package (published to npm as "cckb")
├── tsup.config.ts               # Build config - defines all entry points
├── src/
│   ├── index.ts                 # Main exports
│   ├── bin/cckb.ts              # CLI entry point (cckb command)
│   ├── cli/install.ts           # npm installer logic
│   ├── hooks/                   # Claude Code hook handlers
│   │   ├── session-start.ts     # Creates conversation folder
│   │   ├── user-prompt.ts       # Captures user input
│   │   ├── post-tool-use.ts     # Captures Claude output (filtered)
│   │   ├── stop.ts              # Triggers compaction
│   │   └── notification.ts      # Injects vault context (feedback)
│   ├── core/                    # Business logic
│   │   ├── conversation-manager.ts  # Session state, file rotation
│   │   ├── compaction-engine.ts     # Summarization via Claude SDK
│   │   ├── vault-integrator.ts      # Updates vault from summaries
│   │   ├── entity-detector.ts       # Parses summaries into typed items
│   │   └── index-manager.ts         # INDEX.md management
│   └── utils/
│       ├── config.ts            # Configuration and path helpers
│       ├── file-utils.ts        # File system utilities
│       └── claude-sdk.ts        # Spawns Claude for summarization
├── templates/                   # Files copied during install
│   ├── vault/                   # Initial vault structure
│   │   ├── INDEX.md
│   │   ├── architecture.md
│   │   ├── general-knowledge.md
│   │   ├── entities/INDEX.md
│   │   ├── apps/INDEX.md
│   │   └── modules/INDEX.md
│   ├── CLAUDE.md.tmpl           # Appended to project's CLAUDE.md
│   └── settings.json.tmpl       # Hook configuration
└── scripts/
    ├── install.sh               # Bash installer (alternative to npm)
    └── setup.sh                 # One-time setup after cloning repo
```

### What Gets Installed in Target Projects

```
target-project/
├── .claude/
│   └── settings.json            # Hook configuration merged
├── cc-knowledge-base/
│   ├── .cckb-config.json        # CCKB settings
│   ├── .cckb-state/             # Runtime state (gitignored)
│   │   ├── session-map.json     # Maps transcript paths to sessions
│   │   ├── active-session.json  # Current session ID
│   │   └── vault-cache.json     # Cached indexes for feedback
│   ├── conversations/
│   │   └── {session-id}/
│   │       ├── 0.txt            # Conversation log
│   │       ├── 1.txt            # After rotation
│   │       └── summary.md       # Generated summary
│   └── vault/
│       ├── INDEX.md
│       ├── architecture.md
│       ├── general-knowledge.md
│       ├── entities/
│       │   └── INDEX.md
│       ├── apps/
│       │   └── INDEX.md
│       └── modules/
│           └── INDEX.md
├── CLAUDE.md                    # Vault directives appended
└── .gitignore                   # .cckb-state/ excluded
```

## Hooks

### Hook Configuration (settings.json.tmpl)

All hooks use the same structure:
```json
{
  "matcher": "",
  "hooks": [
    {
      "type": "command",
      "command": "npx cckb hook <handler-name>"
    }
  ]
}
```

### Hook Event → Handler Mapping

| Claude Code Event | Handler File | Purpose |
|-------------------|--------------|---------|
| `SessionStart` | `session-start.ts` | Creates conversation folder, loads vault cache, returns vault overview |
| `UserPromptSubmit` | `user-prompt.ts` | Appends user message to conversation file |
| `PostToolUse` | `post-tool-use.ts` | Captures filtered tool outputs (file paths, commands - not code) |
| `Stop` | `stop.ts` | Triggers async compaction and vault integration |
| `PreToolUse` | `notification.ts` | Injects relevant vault context before Claude acts |

### Hook Protocol

Hooks read JSON from stdin and output JSON to stdout:

**Input** (from Claude Code):
```typescript
interface HookInput {
  session_id?: string;
  transcript_path?: string;
  cwd?: string;
  prompt?: string;           // UserPromptSubmit
  tool_name?: string;        // PostToolUse
  tool_input?: Record<string, unknown>;
}
```

**Output** (to Claude Code):
```typescript
interface HookOutput {
  continue: boolean;         // Always true (don't block)
  suppressOutput?: boolean;  // Always true (stealth mode)
  additionalContext?: string; // Injected into Claude's context
}
```

All hooks fail silently to avoid interrupting Claude Code sessions.

## Core Modules

### ConversationManager (conversation-manager.ts)

- Creates session folders in `conversations/{session-id}/`
- Appends entries with format: `[USER|CLAUDE][timestamp][TOOL:name]\n{content}\n---`
- Rotates files when size threshold exceeded (configurable)
- Maps transcript paths to session IDs for resume handling

### CompactionEngine (compaction-engine.ts)

- Reads all conversation files for a session
- Spawns Claude via CLI (`claude --print -p`) with summarization prompt
- Parses response into structured sections: Entities, Architecture, Services, Knowledge
- Falls back to basic file path extraction if Claude unavailable

### EntityDetector (entity-detector.ts)

Classifies extracted items:
- **entity** → `vault/entities/{name}/`
- **service** → `vault/entities/{parent}/services/` or `vault/services/`
- **pattern** → appended to `vault/architecture.md`
- **knowledge** → appended to `vault/general-knowledge.md`

### VaultIntegrator (vault-integrator.ts)

- Creates folders and INDEX.md files as needed
- Updates parent INDEX.md files up the tree
- Handles both new entries and updates to existing

### IndexManager (index-manager.ts)

- Parses markdown tables in INDEX.md files
- Provides sparse loading (only load what's needed)
- Maintains links between folders

## Configuration

User config at `cc-knowledge-base/.cckb-config.json`:

```json
{
  "compaction": {
    "trigger": "session_end",    // session_end | size | messages | manual
    "sizeThresholdKB": 50,
    "messageThreshold": 100,
    "cleanupAfterSummary": "keep" // keep | archive | delete
  },
  "capture": {
    "tools": ["Write", "Edit", "MultiEdit", "Bash", "Task"],
    "maxContentLength": 500
  },
  "vault": {
    "autoIntegrate": true,
    "maxDepth": 5
  },
  "feedback": {
    "enabled": true,
    "contextDepth": 2
  }
}
```

### Cleanup Options

After compaction generates `summary.md`, original conversation files can be:
- **`keep`** (default): Preserve all files for audit trail and re-processing
- **`archive`**: Compress to `raw.txt.gz` then delete originals
- **`delete`**: Remove originals immediately (summary.md remains)

## Key Implementation Details

### Sparse Loading

Vault is designed for sparse loading - Claude should only read INDEX.md files for navigation, then deep-load specific files when needed. Never load the entire vault at once.

### Conversation Format

```
[USER][2025-01-15T10:30:00Z]
Create an Order entity with id, items, total
---

[CLAUDE][2025-01-15T10:31:00Z][TOOL:Write]
Created: /src/entities/order.ts
---
```

### Template Path Resolution

The CLI finds templates by walking up from `__dirname` looking for `package.json`, then using `templates/` relative to that. This works whether running from source or installed via npm.

## Installation Methods

### 1. npx (Recommended for users)
```bash
npx cckb init
```

### 2. Global install
```bash
npm install -g cckb
cckb init
```

### 3. Bash script (for development/cloning)
```bash
git clone git@github.com:n3m/cckb.git ~/.cckb
~/.cckb/scripts/setup.sh  # One-time: npm install && build && link
~/.cckb/scripts/install.sh  # From any project
```

## Git Workflow

```bash
# After changes
npm run build
npm version patch          # Bumps version, creates git tag
git push origin master --tags
npm publish
```

## Known Considerations

1. **Claude SDK**: Uses `claude --print -p` for summarization. If Claude CLI unavailable, falls back to basic extraction.

2. **Hook Timeouts**: Hooks should complete quickly. The `stop` hook runs compaction async to not block session exit.

3. **State Files**: `.cckb-state/` is gitignored. Contains session mappings and vault cache.

4. **Merge Conflicts**: If multiple developers use CCKB, vault INDEX.md files may conflict. Use append-only strategy.
