#!/bin/bash
# Zelqor CLI installer — https://zelqor.pl
# Usage: curl -fsSL https://zelqor.pl/install.sh | bash
set -euo pipefail

REPO="qwizi/zelqor"
BINARY="zelqor"
INSTALL_DIR="${ZELQOR_INSTALL_DIR:-$HOME/.local/bin}"

# --- Detect platform ---
OS="$(uname -s)"
ARCH="$(uname -m)"

case "$OS" in
  Linux)  os="linux" ;;
  Darwin) os="darwin" ;;
  *)      echo "Error: Unsupported OS: $OS"; exit 1 ;;
esac

case "$ARCH" in
  x86_64|amd64)  arch="x86_64" ;;
  aarch64|arm64) arch="aarch64" ;;
  *)             echo "Error: Unsupported architecture: $ARCH"; exit 1 ;;
esac

TARGET="${os}-${arch}"

# --- Fetch latest release ---
echo "Detecting latest version..."
LATEST=$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" | grep '"tag_name"' | head -1 | cut -d'"' -f4)
if [ -z "$LATEST" ]; then
  echo "Error: Could not determine latest version."
  exit 1
fi
echo "Latest version: $LATEST"

# --- Download ---
ASSET="${BINARY}-${TARGET}.tar.gz"
URL="https://github.com/${REPO}/releases/download/${LATEST}/${ASSET}"

echo "Downloading ${ASSET}..."
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

curl -fsSL "$URL" -o "${TMP}/${ASSET}"
tar -xzf "${TMP}/${ASSET}" -C "$TMP"

# --- Install ---
mkdir -p "$INSTALL_DIR"
mv "${TMP}/${BINARY}" "${INSTALL_DIR}/${BINARY}"
chmod +x "${INSTALL_DIR}/${BINARY}"

echo ""
echo "Zelqor CLI ${LATEST} installed to ${INSTALL_DIR}/${BINARY}"

# --- Check PATH ---
if ! echo "$PATH" | tr ':' '\n' | grep -qx "$INSTALL_DIR"; then
  echo ""
  echo "Add this to your shell profile (~/.bashrc or ~/.zshrc):"
  echo "  export PATH=\"${INSTALL_DIR}:\$PATH\""
fi

echo ""
echo "Run 'zelqor doctor' to verify your setup."
