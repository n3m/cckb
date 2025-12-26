# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

CCKB (Claude Code Knowledge Base) is a TypeScript CLI tool that automatically captures Claude Code conversations and builds a structured knowledge base. It runs as background hooks during Claude Code sessions.

## Build & Development Commands

```bash
npm run build        # Build with tsup (outputs to dist/)
npm run dev          # Watch mode build
npm run typecheck    # Type checking without emit
npm run test         # Run tests with vitest
```

### Testing Locally

```bash
# Test the CLI in a temporary project
node dist/bin/cckb.js init /tmp/test-project
```

## Architecture

### Core Pipeline

1. **Capture** (hooks) → **Compact** (CompactionEngine) → **Integrate** (VaultIntegrator)

Session starts → hooks capture user prompts and tool outputs → session ends → conversation is summarized via Claude SDK → entities/patterns/knowledge extracted → vault updated.

### Entry Points (tsup.config.ts)

- `src/bin/cckb.ts` - CLI entry point
- `src/hooks/*.ts` - Individual hook handlers (session-start, user-prompt, post-tool-use, stop, notification)

### Core Modules (src/core/)

- **ConversationManager** - Session state, conversation file rotation, appending entries
- **CompactionEngine** - Summarizes conversations using Claude SDK, extracts structured data
- **VaultIntegrator** - Writes extracted knowledge to vault markdown files
- **EntityDetector** - Parses summaries into typed items (entity, service, pattern, knowledge)
- **IndexManager** - Manages INDEX.md files for sparse vault loading

### Key Paths (src/utils/config.ts)

- Knowledge base: `<project>/cc-knowledge-base/`
- Conversations: `<project>/cc-knowledge-base/conversations/`
- Vault: `<project>/cc-knowledge-base/vault/`
- State: `<project>/cc-knowledge-base/.cckb-state/`

### Hook Protocol

Hooks read JSON from stdin (`session_id`, `transcript_path`, `cwd`, etc.) and output JSON to stdout:
```typescript
interface HookOutput {
  continue: boolean;
  suppressOutput?: boolean;
  additionalContext?: string;
}
```

All hooks fail silently to avoid interrupting Claude Code sessions.

### Templates (templates/)

- `vault/` - Initial vault structure copied during install
- `CLAUDE.md.tmpl` - Content appended to project's CLAUDE.md
- `settings.json.tmpl` - Hook configuration merged into `.claude/settings.json`

## Configuration

User config at `cc-knowledge-base/.cckb-config.json`:

| Key | Purpose |
|-----|---------|
| `compaction.trigger` | When to summarize (session_end, size, messages, manual) |
| `capture.tools` | Which tool outputs to capture |
| `vault.autoIntegrate` | Auto-update vault after compaction |
| `feedback.contextDepth` | INDEX levels to load for context injection |
