#!/usr/bin/env bash
set -e

# Gelada MCP CLI Installer Script
# Automatically detects OS and Architecture, downloads the release binary archive, and installs `gelada`.

REPO="${GELADA_REPO:-pcherkasov/gelada-mcp}"
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

if ! command -v curl >/dev/null 2>&1 && ! command -v wget >/dev/null 2>&1; then
  echo "Error: Neither curl nor wget is available."
  exit 1
fi

# 3. Resolve the release tag
#
# Every asset is named after its tag (gelada-v0.1.3-darwin-arm64.tar.gz), so
# "latest" has to become a real version before a filename can be built —
# /releases/latest/download/ cannot help when the version is part of the name.
# GitHub redirects /releases/latest to /releases/tag/<tag>; reading that costs no
# API rate limit, unlike the REST endpoint.
resolve_latest_tag() {
  if command -v curl >/dev/null 2>&1; then
    curl -fsSLI -o /dev/null -w '%{url_effective}' \
      "https://github.com/${REPO}/releases/latest" | sed -n 's#.*/releases/tag/##p'
  else
    wget -qS --spider "https://github.com/${REPO}/releases/latest" 2>&1 |
      sed -n 's#^[[:space:]]*Location:[[:space:]]*.*/releases/tag/\([^[:space:]]*\).*#\1#p' |
      tail -n 1
  fi
}

if [ "$TAG" = "latest" ]; then
  TAG="$(resolve_latest_tag)"
  if [ -z "$TAG" ]; then
    echo "Error: Could not determine the latest Gelada release."
    echo "Set GELADA_VERSION to a released version, e.g. GELADA_VERSION=0.1.3."
    exit 1
  fi
fi

# Accept both spellings; the assets are tagged with the leading v.
case "$TAG" in
  v*) ;;
  *) TAG="v${TAG}" ;;
esac

ARCHIVE_NAME="gelada-${TAG}-${OS}-${ARCH}.tar.gz"
DOWNLOAD_URL="https://github.com/${REPO}/releases/download/${TAG}/${ARCHIVE_NAME}"

echo "Downloading Gelada MCP CLI ${TAG} for ${OS}-${ARCH}..."
echo "URL: ${DOWNLOAD_URL}"

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

if command -v curl >/dev/null 2>&1; then
  curl -fsSL "$DOWNLOAD_URL" -o "${TMP_DIR}/${ARCHIVE_NAME}"
else
  wget -qO "${TMP_DIR}/${ARCHIVE_NAME}" "$DOWNLOAD_URL"
fi

# Verify against the checksums published with the release.
#
# Every release ships one checksums.txt covering all five archives. Nothing used
# to read it: `gelada update` looked for a per-asset .sha256 that has never
# existed and skipped verification with a warning every single time.
CHECKSUMS_URL="https://github.com/${REPO}/releases/download/${TAG}/checksums.txt"
if command -v curl >/dev/null 2>&1; then
  curl -fsSL "$CHECKSUMS_URL" -o "${TMP_DIR}/checksums.txt" || true
else
  wget -qO "${TMP_DIR}/checksums.txt" "$CHECKSUMS_URL" || true
fi

if [ -s "${TMP_DIR}/checksums.txt" ]; then
  EXPECTED="$(awk -v name="$ARCHIVE_NAME" '$2 == name || $2 == "*" name { print $1 }' \
    "${TMP_DIR}/checksums.txt" | head -n 1)"

  if [ -z "$EXPECTED" ]; then
    echo "Error: ${ARCHIVE_NAME} is not listed in checksums.txt for ${TAG}."
    exit 1
  fi

  if command -v sha256sum >/dev/null 2>&1; then
    ACTUAL="$(sha256sum "${TMP_DIR}/${ARCHIVE_NAME}" | cut -d' ' -f1)"
  elif command -v shasum >/dev/null 2>&1; then
    ACTUAL="$(shasum -a 256 "${TMP_DIR}/${ARCHIVE_NAME}" | cut -d' ' -f1)"
  else
    ACTUAL=""
    echo "Warning: no sha256sum or shasum available; skipping checksum verification."
  fi

  if [ -n "$ACTUAL" ]; then
    if [ "$ACTUAL" != "$EXPECTED" ]; then
      echo "Error: checksum mismatch for ${ARCHIVE_NAME}."
      echo "  expected: ${EXPECTED}"
      echo "  actual:   ${ACTUAL}"
      exit 1
    fi
    echo "Checksum verified."
  fi
else
  echo "Warning: could not download checksums.txt for ${TAG}; skipping verification."
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

# Land the binary by rename, never by writing over the destination.
#
# Copying onto the target truncates whatever is there and fills it back in, so
# an install interrupted midway — full disk, ^C, a dropped network mount —
# leaves a `gelada` that exists and does not run. Renaming a fully written
# sibling into place is atomic: the old binary stays intact until the instant
# the new one replaces it, and the file any running process is executing is
# never opened for writing at all. That last part matters here because
# `gelada update` upgrades the binary it is itself running from.
STAGED="${INSTALL_DIR}/.gelada.new.$$"

if [ -w "$INSTALL_DIR" ]; then
  cp "$BINARY_PATH" "$STAGED"
  chmod +x "$STAGED"
  mv -f "$STAGED" "${INSTALL_DIR}/gelada"
else
  sudo cp "$BINARY_PATH" "$STAGED"
  sudo chmod +x "$STAGED"
  sudo mv -f "$STAGED" "${INSTALL_DIR}/gelada"
fi

echo "Gelada MCP CLI installed successfully to ${INSTALL_DIR}/gelada"
echo "Run 'gelada --help' to get started."
