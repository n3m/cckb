## ⚠️ WORK IN PROGRESS ⚠️

**This project is under active development. Features may change, break, or be incomplete. We welcome contributions — feel free to open issues, submit pull requests, or share feedback!**

---

# CCKB - Claude Code Knowledge Base

**Automatic project knowledge capture for Claude Code**

CCKB runs silently in the background, capturing conversations and building a structured knowledge base that Claude can reference in future sessions. No manual documentation needed — your project learns as you work.

---

## How It Works

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         Claude Code Session                              │
│                                                                          │
│  You: "Create an Order entity with id, items, total"                    │
│                                    │                                     │
│                                    ▼                                     │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │                    CCKB Hooks (Background)                        │   │
│  │                                                                   │   │
│  │  📝 Captures conversation              🔍 Provides vault context  │   │
│  │  📁 Logs to conversations/             💡 Injects relevant info   │   │
│  │  🗜️  Summarizes on session end         📚 Updates knowledge base  │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                    │                                     │
└────────────────────────────────────┼─────────────────────────────────────┘
                                     ▼
                    ┌─────────────────────────────────────┐
                    │       cc-knowledge-base/            │
                    │                                     │
                    │  vault/                             │
                    │  ├── INDEX.md                       │
                    │  ├── architecture.md                │
                    │  ├── general-knowledge.md           │
                    │  └── entities/                      │
                    │      ├── INDEX.md                   │
                    │      └── order/                     │
                    │          ├── INDEX.md               │
                    │          ├── attributes.md          │
                    │          └── services.md            │
                    │                                     │
                    │  conversations/                     │
                    │  └── {session-id}/                  │
                    │      ├── 0.txt                      │
                    │      └── summary.md                 │
                    └─────────────────────────────────────┘
```

### The Cycle

1. **Capture** — Hooks silently log user prompts and Claude's actions
2. **Compact** — On session end, conversations are summarized
3. **Integrate** — Entities, patterns, and knowledge are extracted and organized
4. **Feedback** — Future sessions receive relevant context from the vault

---

## Installation

### Option 1: npx (Recommended)

```bash
# From your project directory
npx cckb init

# Install and analyze existing codebase
npx cckb init --discover
```

### Option 2: Global Install

```bash
npm install -g cckb
# Then from any project:
cckb init
```

### Option 3: pnpm

```bash
pnpm dlx cckb init
```

### Bootstrapping Existing Projects

For existing codebases, use the `discover` command to analyze and populate the vault:

```bash
# After init, or anytime
cckb discover

# Or during install
cckb init --discover
```

The discover command uses Claude to analyze your codebase and automatically populate the vault with:
- **Entities** — Data models, types, interfaces
- **Architecture** — Design patterns, structural decisions
- **Services** — Controllers, handlers, business logic
- **Knowledge** — Conventions, configuration, project context

---

## What Gets Installed

```
your-project/
├── .claude/
│   └── settings.json        # Hook configuration added
├── cc-knowledge-base/
│   ├── .cckb-config.json    # CCKB settings
│   ├── conversations/       # Session logs
│   └── vault/               # Knowledge base
│       ├── INDEX.md
│       ├── architecture.md
│       ├── general-knowledge.md
│       └── entities/
│           └── INDEX.md
├── CLAUDE.md                # Vault directives added
└── .gitignore               # State files excluded
```

---

## Configuration

Edit `cc-knowledge-base/.cckb-config.json`:

```json
{
  "compaction": {
    "trigger": "session_end",
    "sizeThresholdKB": 50,
    "cleanupAfterSummary": "keep"
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
  },
  "discover": {
    "maxFiles": 100,
    "maxChunkSize": 50000,
    "supportedLanguages": ["typescript", "javascript", "python", "go", "rust"]
  }
}
```

| Option | Description |
|--------|-------------|
| `compaction.trigger` | When to summarize: `session_end`, `size`, `messages`, or `manual` |
| `compaction.sizeThresholdKB` | File size threshold for rotation |
| `compaction.cleanupAfterSummary` | After compaction: `keep`, `archive`, or `delete` original files |
| `capture.tools` | Which tool outputs to capture |
| `capture.maxContentLength` | Max characters per tool output |
| `vault.autoIntegrate` | Auto-update vault after compaction |
| `vault.maxDepth` | Maximum folder nesting depth |
| `feedback.enabled` | Inject vault context into sessions |
| `feedback.contextDepth` | How many INDEX levels to load |
| `discover.maxFiles` | Maximum files to analyze |
| `discover.maxChunkSize` | Characters per Claude analysis chunk |
| `discover.supportedLanguages` | Languages to analyze |

---

## Vault Structure

The vault uses **sparse loading** — Claude only reads INDEX.md files for navigation, loading specific files only when needed.

### INDEX.md Format

```markdown
# Entities

## Contents

| Item | Description |
|------|-------------|
| [user/](./user/INDEX.md) | User authentication and profiles |
| [order/](./order/INDEX.md) | Order processing and tracking |
```

### Entity Documentation

```
entities/order/
├── INDEX.md          # Overview and links
├── attributes.md     # Fields: id, items, total, status
└── services/
    ├── INDEX.md
    ├── repository.md # Data access methods
    └── usecase.md    # Business logic
```

---

## Hooks

CCKB installs these Claude Code hooks:

| Hook | Purpose |
|------|---------|
| `SessionStart` | Creates conversation folder, loads vault cache |
| `UserPromptSubmit` | Captures user messages |
| `PostToolUse` | Captures Claude's actions (filtered) |
| `Stop` | Triggers compaction and vault integration |
| `PreToolUse` | Injects relevant vault context |

All hooks run silently in the background.

---

## Commands

```bash
cckb init [path]           # Install CCKB in a project
cckb init --force          # Reinstall, overwriting existing config
cckb init --discover       # Install and analyze existing codebase
cckb discover [path]       # Analyze codebase and populate vault
cckb discover --verbose    # Show detailed progress
cckb hook <name>           # Run a hook (internal use)
cckb version               # Show version
cckb help                  # Show help
```

---

## How Claude Uses the Vault

CCKB adds directives to your `CLAUDE.md`:

```markdown
## Project Knowledge Base (CCKB)

### Usage Guidelines

1. Before creating new entities/services:
   - Check vault INDEX.md for existing patterns
   - Review related entity structures
   - Follow established architecture

2. When uncertain about project conventions:
   - Consult vault/general-knowledge.md
   - Check entity-specific INDEX.md files

3. Sparse Loading:
   - Start with INDEX.md files only
   - Deep-load specific files only when needed
```

---

## Development

```bash
# Clone the repo
git clone https://github.com/n3m/cckb.git
cd cckb

# Install dependencies
npm install

# Build
npm run build

# Test locally
node dist/bin/cckb.js init /tmp/test-project
```

---

## License

MIT
