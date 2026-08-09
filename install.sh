#!/usr/bin/env bash
set -e

# Gelada MCP CLI Installer Script
# Automatically detects OS and Architecture, downloads the release binary archive, and installs `gelada`.

REPO="${GELADA_REPO:-zugoman/gelada-mcp}"
TAG="${GELADA_VERSION:-latest}"
INSTALL_DIR="${INSTALL_DIR:-/usr/local/bin}"

# 1. Detect OS
OS_TYPE="$(uname -s | tr '[:upper:]' '[:lower:]')"
case "$OS_TYPE" in
  darwin)
    OS="darwin"
    ;;
  linux)
    OS="linux"
    ;;
  *)
    echo "Error: Unsupported operating system '$OS_TYPE'."
    exit 1
    ;;
esac

# 2. Detect Architecture
ARCH_TYPE="$(uname -m)"
case "$ARCH_TYPE" in
  x86_64|amd64)
    ARCH="x64"
    ;;
  aarch64|arm64)
    ARCH="arm64"
    ;;
  *)
    echo "Error: Unsupported architecture '$ARCH_TYPE'."
    exit 1
    ;;
esac

# 3. Determine download URL
if [ "$TAG" = "latest" ]; then
  RELEASE_URL="https://github.com/${REPO}/releases/latest/download"
else
  RELEASE_URL="https://github.com/${REPO}/releases/download/${TAG}"
fi

ARCHIVE_NAME="gelada-${TAG}-${OS}-${ARCH}.tar.gz"
DOWNLOAD_URL="${RELEASE_URL}/${ARCHIVE_NAME}"

echo "Downloading Gelada MCP CLI for ${OS}-${ARCH}..."
echo "URL: ${DOWNLOAD_URL}"

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

if command -v curl >/dev/null 2>&1; then
  curl -fsSL "$DOWNLOAD_URL" -o "${TMP_DIR}/${ARCHIVE_NAME}"
elif command -v wget >/dev/null 2>&1; then
  wget -qO "${TMP_DIR}/${ARCHIVE_NAME}" "$DOWNLOAD_URL"
else
  echo "Error: Neither curl nor wget is available."
  exit 1
fi

echo "Extracting archive..."
tar -xzf "${TMP_DIR}/${ARCHIVE_NAME}" -C "$TMP_DIR"

BINARY_PATH=""
if [ -f "${TMP_DIR}/gelada-${OS}-${ARCH}" ]; then
  BINARY_PATH="${TMP_DIR}/gelada-${OS}-${ARCH}"
elif [ -f "${TMP_DIR}/gelada" ]; then
  BINARY_PATH="${TMP_DIR}/gelada"
else
  BINARY_PATH="$(find "$TMP_DIR" -type f -name 'gelada*' ! -name '*.tar.gz' | head -n 1)"
fi

if [ -z "$BINARY_PATH" ] || [ ! -f "$BINARY_PATH" ]; then
  echo "Error: Could not locate extracted gelada binary."
  exit 1
fi

echo "Installing binary to ${INSTALL_DIR}..."
if [ ! -d "$INSTALL_DIR" ]; then
  mkdir -p "$INSTALL_DIR" 2>/dev/null || sudo mkdir -p "$INSTALL_DIR"
fi

if [ -w "$INSTALL_DIR" ]; then
  cp "$BINARY_PATH" "${INSTALL_DIR}/gelada"
  chmod +x "${INSTALL_DIR}/gelada"
else
  sudo cp "$BINARY_PATH" "${INSTALL_DIR}/gelada"
  sudo chmod +x "${INSTALL_DIR}/gelada"
fi

echo "Gelada MCP CLI installed successfully to ${INSTALL_DIR}/gelada"
echo "Run 'gelada --help' to get started."
