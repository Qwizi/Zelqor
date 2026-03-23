#!/bin/bash
# Build MapLord Desktop for Steam distribution.
#
# Prerequisites:
#   - Rust 1.88+ with cargo
#   - pnpm (for frontend)
#   - Steamworks SDK redistributable (steam_api.dll / libsteam_api.so)
#
# Usage:
#   ./build.sh          # Debug build
#   ./build.sh release  # Release build for Steam distribution

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

MODE="${1:-debug}"

echo "==> Building MapLord Desktop (${MODE})"

# 1. Build frontend
echo "==> Building frontend..."
cd "$PROJECT_ROOT/frontend"
pnpm install --frozen-lockfile
pnpm build

# 2. Export frontend as static files for Tauri
echo "==> Exporting frontend static files..."
mkdir -p "$SCRIPT_DIR/dist"
cp -r "$PROJECT_ROOT/frontend/.next/static" "$SCRIPT_DIR/dist/" 2>/dev/null || true

# 3. Build Tauri app
echo "==> Building Tauri backend..."
cd "$SCRIPT_DIR/src-tauri"

if [ "$MODE" = "release" ]; then
    cargo build --release
    echo "==> Release build complete!"
    echo "    Binary: target/release/maplord-desktop"
    echo ""
    echo "==> Next steps for Steam distribution:"
    echo "    1. Copy Steamworks SDK redistributable files alongside the binary"
    echo "    2. Update steam_appid.txt with your real App ID"
    echo "    3. Use SteamPipe to upload the build to Steam"
else
    cargo build
    echo "==> Debug build complete!"
    echo "    Binary: target/debug/maplord-desktop"
fi
