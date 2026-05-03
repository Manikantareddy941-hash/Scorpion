#!/bin/bash

# SCORPION Hook Installer
# -------------------------

HOOK_SRC="scripts/hooks/pre-commit"
HOOK_DEST=".git/hooks/pre-commit"

if [ ! -f "$HOOK_SRC" ]; then
    echo "Error: $HOOK_SRC not found. Run this script from the project root."
    exit 1
fi

if [ ! -d ".git" ]; then
    echo "Error: .git directory not found. Are you in the project root?"
    exit 1
fi

echo "Installing SCORPION pre-commit hook..."
cp "$HOOK_SRC" "$HOOK_DEST"
chmod +x "$HOOK_DEST"

echo "Success! SCORPION pre-commit hook is now active."
echo "Every time you commit, SCORPION will check for secrets and vulnerabilities."
