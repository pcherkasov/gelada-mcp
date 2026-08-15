#!/usr/bin/env bash
set -uo pipefail

# Runs install.sh against a real published release, the way a user would.
#
# The installer has exactly one shape anyone types — curl it, run it, get a
# working `gelada` — and that shape was broken from 0.1.0 through 0.1.3 without
# anything noticing: it asked for gelada-latest-<os>-<arch>.tar.gz while the
# assets are named after the tag, so every default run 404'd on every platform.
# No unit test reaches that bug. Only downloading a real release does, which is
# what this script is for.
#
# The installer is fetched from the release rather than from the checkout,
# because that is the file users actually run — and fetching it also proves it
# was attached to the release at all.
#
# Usage: verify-install.sh <version>   # e.g. 0.1.5, no leading v

VERSION="${1:-}"
if [ -z "$VERSION" ]; then
  echo "usage: verify-install.sh <version>   (e.g. 0.1.5)" >&2
  exit 2
fi

REPO="${GELADA_REPO:-pcherkasov/gelada-mcp}"
RELEASE_URL="https://github.com/${REPO}/releases/download/v${VERSION}"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
INSTALLER="${WORK}/install.sh"

fail() {
  # ::error:: makes CI surface the line in the run summary, not just the log.
  echo "::error::$*"
  echo "FAIL: $*" >&2
}

# A release created seconds ago is not always downloadable on the first try, and
# the /releases/latest pointer lags it a little further. Both waits are bounded:
# a release that never becomes readable is a real failure, not something to sit
# through.
echo "Fetching the installer published with v${VERSION}..."
for attempt in $(seq 1 12); do
  if curl -fsSL "${RELEASE_URL}/install.sh" -o "$INSTALLER"; then
    break
  fi
  if [ "$attempt" -eq 12 ]; then
    fail "install.sh was not downloadable from v${VERSION} after 60s: ${RELEASE_URL}/install.sh"
    exit 1
  fi
  echo "  not there yet (attempt ${attempt}/12), retrying in 5s..."
  sleep 5
done

# The default run resolves "latest" through GitHub's own pointer, so it can only
# be asserted against this version once the pointer has caught up. If it settles
# on something else, a plain `curl … | bash` would hand users that other version
# — worth failing over.
echo "Waiting for /releases/latest to point at v${VERSION}..."
resolved=""
for attempt in $(seq 1 12); do
  resolved="$(curl -fsSLI -o /dev/null -w '%{url_effective}' \
    "https://github.com/${REPO}/releases/latest" | sed -n 's#.*/releases/tag/##p')"
  if [ "$resolved" = "v${VERSION}" ]; then
    break
  fi
  if [ "$attempt" -eq 12 ]; then
    fail "/releases/latest still points at '${resolved:-nothing}' after 60s; a default install would deliver that, not v${VERSION}"
    exit 1
  fi
  echo "  points at '${resolved:-nothing}' (attempt ${attempt}/12), retrying in 5s..."
  sleep 5
done

failures=0

# Every case must end with a binary that runs and reports this exact version.
# Running it is the point: an archive can download and unpack perfectly and still
# contain something the platform refuses to execute, which is how the unsigned
# darwin binaries in 0.1.0 and 0.1.1 shipped.
check() {
  local label="$1"
  local version_env="$2"
  local dir status actual
  dir="${WORK}/case-$(echo "$label" | tr -cs '[:alnum:]' '-')"

  echo ""
  echo "=== install.sh: ${label} ==="

  if [ -n "$version_env" ]; then
    GELADA_VERSION="$version_env" INSTALL_DIR="$dir" bash "$INSTALLER"
    status=$?
  else
    env -u GELADA_VERSION INSTALL_DIR="$dir" bash "$INSTALLER"
    status=$?
  fi

  if [ "$status" -ne 0 ]; then
    fail "${label}: install.sh exited ${status}"
    failures=$((failures + 1))
    return
  fi

  if [ ! -x "${dir}/gelada" ]; then
    fail "${label}: no executable at ${dir}/gelada after install.sh reported success"
    failures=$((failures + 1))
    return
  fi

  actual="$("${dir}/gelada" --version 2>&1)"
  status=$?
  if [ "$status" -ne 0 ]; then
    fail "${label}: the installed binary exited ${status} running --version: ${actual}"
    failures=$((failures + 1))
    return
  fi

  if [ "$actual" != "$VERSION" ]; then
    fail "${label}: installed binary reports '${actual}', expected '${VERSION}'"
    failures=$((failures + 1))
    return
  fi

  echo "ok: ${label} installed ${actual}"
}

check "default (GELADA_VERSION unset)" ""
check "GELADA_VERSION=v${VERSION}" "v${VERSION}"
check "GELADA_VERSION=${VERSION}" "${VERSION}"

echo ""
if [ "$failures" -ne 0 ]; then
  fail "${failures} install.sh case(s) failed for v${VERSION} on $(uname -s)/$(uname -m)"
  exit 1
fi

echo "install.sh verified on $(uname -s)/$(uname -m): all 3 cases installed ${VERSION}"
