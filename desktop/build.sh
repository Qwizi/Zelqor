#!/bin/bash
# Build Zelqor Desktop app.
#
# Usage:
#   ./build.sh              # Debug build (no Steam)
#   ./build.sh release      # Release build (no Steam)
#   ./build.sh steam        # Debug build with Steam
#   ./build.sh release steam # Release build with Steam
#
# The app loads https://zelqor.qwizi.ovh in a native window.
# For local dev, run: cargo tauri dev (uses localhost:3000)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

MODE="debug"
FEATURES=""

for arg in "$@"; do
    case "$arg" in
        release) MODE="release" ;;
        steam) FEATURES="--features steam" ;;
    esac
done

echo "==> Building Zelqor Desktop (mode=${MODE}, steam=$([ -n "$FEATURES" ] && echo yes || echo no))"

cd "$SCRIPT_DIR/src-tauri"

if [ "$MODE" = "release" ]; then
    cargo build --release $FEATURES
    echo "==> Release build: target/release/zelqor-desktop"
else
    cargo build $FEATURES
    echo "==> Debug build: target/debug/zelqor-desktop"
fi
