#!/bin/bash

# =============================================================================
# CCKB Setup Script
# Run once after cloning to build and link the package
# =============================================================================

set -e

# Colors
GREEN='\033[38;2;0;234;179m'
BLUE='\033[38;2;0;208;255m'
YELLOW='\033[38;2;255;185;0m'
NC='\033[0m'

# Get the directory where this script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
BASE_DIR="$(dirname "$SCRIPT_DIR")"

echo ""
echo -e "${BLUE}=== CCKB Setup ===${NC}"
echo ""

cd "$BASE_DIR"

# Install dependencies
echo -e "${BLUE}Installing dependencies...${NC}"
npm install

# Build TypeScript
echo -e "${BLUE}Building TypeScript...${NC}"
npm run build

# Link globally (makes 'cckb' command available)
echo -e "${BLUE}Linking package globally...${NC}"
npm link

echo ""
echo -e "${GREEN}✓ CCKB setup complete!${NC}"
echo ""
echo "You can now:"
echo "  1. Run 'cckb init' from any project directory"
echo "  2. Or use '~/.cckb/scripts/install.sh' directly"
echo ""
echo -e "${YELLOW}Add this alias to your shell config for convenience:${NC}"
echo "  alias cckb-install=\"~/.cckb/scripts/install.sh\""
echo ""
