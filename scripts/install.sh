#!/bin/bash

# =============================================================================
# CCKB Project Installation Script
# Installs Claude Code Knowledge Base into a project
# =============================================================================

set -e  # Exit on error

# Colors for output
RED='\033[38;2;255;32;86m'
GREEN='\033[38;2;0;234;179m'
YELLOW='\033[38;2;255;185;0m'
BLUE='\033[38;2;0;208;255m'
NC='\033[0m' # No Color

# Get the directory where this script is located (CCKB base)
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
BASE_DIR="$(dirname "$SCRIPT_DIR")"
PROJECT_DIR="$(pwd)"

# -----------------------------------------------------------------------------
# Default Values
# -----------------------------------------------------------------------------

FORCE="false"

# -----------------------------------------------------------------------------
# Output Functions
# -----------------------------------------------------------------------------

print_status() {
    echo -e "${BLUE}$1${NC}"
}

print_success() {
    echo -e "${GREEN}✓ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

print_error() {
    echo -e "${RED}✗ $1${NC}"
}

# -----------------------------------------------------------------------------
# Help Function
# -----------------------------------------------------------------------------

show_help() {
    cat << EOF
Usage: $0 [OPTIONS] [PATH]

Install CCKB (Claude Code Knowledge Base) into a project.

Arguments:
    PATH                Path to project (default: current directory)

Options:
    --force             Overwrite existing installation
    -h, --help          Show this help message

Examples:
    $0                  Install in current directory
    $0 ./myproject      Install in ./myproject
    $0 --force          Reinstall, overwriting existing config

EOF
    exit 0
}

# -----------------------------------------------------------------------------
# Parse Command Line Arguments
# -----------------------------------------------------------------------------

parse_arguments() {
    while [[ $# -gt 0 ]]; do
        case $1 in
            --force)
                FORCE="true"
                shift
                ;;
            -h|--help)
                show_help
                ;;
            -*)
                print_error "Unknown option: $1"
                show_help
                ;;
            *)
                PROJECT_DIR="$(cd "$1" 2>/dev/null && pwd)" || {
                    print_error "Directory not found: $1"
                    exit 1
                }
                shift
                ;;
        esac
    done
}

# -----------------------------------------------------------------------------
# Validation Functions
# -----------------------------------------------------------------------------

validate_project_path() {
    if [[ ! -d "$PROJECT_DIR" ]]; then
        print_error "Target path does not exist: $PROJECT_DIR"
        exit 1
    fi
}

check_existing_installation() {
    local kb_path="$PROJECT_DIR/cc-knowledge-base"

    if [[ -d "$kb_path" ]] && [[ "$FORCE" != "true" ]]; then
        print_error "CCKB is already installed in this project."
        echo ""
        echo "Use --force to reinstall."
        exit 1
    fi
}

# -----------------------------------------------------------------------------
# Installation Functions
# -----------------------------------------------------------------------------

create_directory_structure() {
    print_status "Creating directory structure..."

    mkdir -p "$PROJECT_DIR/cc-knowledge-base/conversations"
    mkdir -p "$PROJECT_DIR/cc-knowledge-base/vault/entities"
    mkdir -p "$PROJECT_DIR/cc-knowledge-base/vault/apps"
    mkdir -p "$PROJECT_DIR/cc-knowledge-base/vault/modules"
    mkdir -p "$PROJECT_DIR/cc-knowledge-base/.cckb-state"

    # Create .gitkeep for conversations
    touch "$PROJECT_DIR/cc-knowledge-base/conversations/.gitkeep"

    print_success "Created directory structure"
}

copy_vault_templates() {
    print_status "Copying vault templates..."

    local templates_dir="$BASE_DIR/templates/vault"

    cp "$templates_dir/INDEX.md" "$PROJECT_DIR/cc-knowledge-base/vault/"
    cp "$templates_dir/architecture.md" "$PROJECT_DIR/cc-knowledge-base/vault/"
    cp "$templates_dir/general-knowledge.md" "$PROJECT_DIR/cc-knowledge-base/vault/"
    cp "$templates_dir/entities/INDEX.md" "$PROJECT_DIR/cc-knowledge-base/vault/entities/"
    cp "$templates_dir/apps/INDEX.md" "$PROJECT_DIR/cc-knowledge-base/vault/apps/"
    cp "$templates_dir/modules/INDEX.md" "$PROJECT_DIR/cc-knowledge-base/vault/modules/"

    print_success "Copied vault templates"
}

create_config_file() {
    print_status "Creating configuration..."

    cat > "$PROJECT_DIR/cc-knowledge-base/.cckb-config.json" << 'EOF'
{
  "compaction": {
    "trigger": "session_end",
    "sizeThresholdKB": 50,
    "messageThreshold": 100,
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
  }
}
EOF

    print_success "Created configuration file"
}

install_hooks() {
    print_status "Installing hooks..."

    local claude_dir="$PROJECT_DIR/.claude"
    local settings_file="$claude_dir/settings.json"

    mkdir -p "$claude_dir"

    # Load hooks template
    local hooks_template="$BASE_DIR/templates/settings.json.tmpl"

    if [[ -f "$settings_file" ]]; then
        # Merge with existing settings using node
        if command -v node &> /dev/null; then
            node -e "
                const fs = require('fs');
                const existing = JSON.parse(fs.readFileSync('$settings_file', 'utf8'));
                const template = JSON.parse(fs.readFileSync('$hooks_template', 'utf8'));

                existing.hooks = existing.hooks || {};

                // Merge hooks, CCKB hooks take precedence
                for (const [hookType, hooks] of Object.entries(template.hooks)) {
                    existing.hooks[hookType] = existing.hooks[hookType] || [];

                    // Remove any existing CCKB hooks
                    existing.hooks[hookType] = existing.hooks[hookType].filter(h => {
                        const cmd = h.command || (h.hooks && h.hooks[0]?.command);
                        return !cmd?.includes('cckb');
                    });

                    // Add new CCKB hooks
                    existing.hooks[hookType].push(...hooks);
                }

                fs.writeFileSync('$settings_file', JSON.stringify(existing, null, 2));
            "
        else
            # Fallback: just copy the template
            cp "$hooks_template" "$settings_file"
        fi
    else
        cp "$hooks_template" "$settings_file"
    fi

    print_success "Installed hook configuration"
}

update_claude_md() {
    print_status "Updating CLAUDE.md..."

    local claude_md="$PROJECT_DIR/CLAUDE.md"
    local template="$BASE_DIR/templates/CLAUDE.md.tmpl"
    local marker="## Project Knowledge Base (CCKB)"

    if [[ -f "$claude_md" ]]; then
        if grep -q "$marker" "$claude_md"; then
            # Replace existing section
            # Use a temporary file for safe editing
            local temp_file=$(mktemp)
            awk -v marker="$marker" -v template="$(cat "$template")" '
                BEGIN { skip=0 }
                $0 ~ marker { skip=1; print template; next }
                skip && /^## / && $0 !~ marker { skip=0 }
                !skip { print }
            ' "$claude_md" > "$temp_file"
            mv "$temp_file" "$claude_md"
        else
            # Append section
            echo "" >> "$claude_md"
            cat "$template" >> "$claude_md"
        fi
    else
        cat "$template" > "$claude_md"
    fi

    print_success "Updated CLAUDE.md"
}

update_gitignore() {
    print_status "Updating .gitignore..."

    local gitignore="$PROJECT_DIR/.gitignore"
    local entry="cc-knowledge-base/.cckb-state/"

    if [[ -f "$gitignore" ]]; then
        if ! grep -q "$entry" "$gitignore"; then
            echo "" >> "$gitignore"
            echo "# CCKB state files" >> "$gitignore"
            echo "$entry" >> "$gitignore"
        fi
    else
        echo "# CCKB state files" > "$gitignore"
        echo "$entry" >> "$gitignore"
    fi

    print_success "Updated .gitignore"
}

# -----------------------------------------------------------------------------
# Main Execution
# -----------------------------------------------------------------------------

main() {
    echo ""
    echo -e "${BLUE}=== CCKB Installation ===${NC}"
    echo ""

    parse_arguments "$@"

    echo "Installing CCKB to: $PROJECT_DIR"
    echo ""

    validate_project_path
    check_existing_installation

    create_directory_structure
    copy_vault_templates
    create_config_file
    install_hooks
    update_claude_md
    update_gitignore

    echo ""
    print_success "CCKB installed successfully!"
    echo ""
    echo "Next steps:"
    echo "  1. Review cc-knowledge-base/vault/ structure"
    echo "  2. Check .claude/settings.json for hook configuration"
    echo "  3. Start a new Claude Code session to begin capturing knowledge"
    echo ""
}

main "$@"
