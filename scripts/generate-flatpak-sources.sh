#!/usr/bin/env bash
# Regenerate flatpak/cargo-sources.json and flatpak/node-sources.json from the
# current lockfiles. Run this whenever Cargo.lock or package-lock.json changes,
# then commit all three files together.
#
# Prerequisites (install once):
#   pip install toml aiohttp
#   pip install flatpak-node-generator
#   # flatpak-cargo-generator.py is fetched from flatpak-builder-tools below

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FLATPAK_DIR="$REPO_ROOT/flatpak"
TOOLS_DIR="$REPO_ROOT/.flatpak-builder-tools"

echo "==> Updating flatpak-builder-tools..."
if [ -d "$TOOLS_DIR" ]; then
    git -C "$TOOLS_DIR" pull --quiet
else
    git clone --quiet --depth=1 \
        https://github.com/flatpak/flatpak-builder-tools.git "$TOOLS_DIR"
fi

echo "==> Generating cargo-sources.json..."
python3 "$TOOLS_DIR/cargo/flatpak-cargo-generator.py" \
    "$REPO_ROOT/src-tauri/Cargo.lock" \
    -o "$FLATPAK_DIR/cargo-sources.json"

echo "==> Generating node-sources.json..."
# Use the git version from flatpak-builder-tools — the pip package has a bug
# with lockfileVersion 3 that causes most packages to be omitted.
(cd "$TOOLS_DIR/node" && python3 -m flatpak_node_generator \
    npm "$REPO_ROOT/package-lock.json" \
    -o "$FLATPAK_DIR/node-sources.json")

echo ""
echo "Done. Commit these files:"
echo "  flatpak/cargo-sources.json"
echo "  flatpak/node-sources.json"
