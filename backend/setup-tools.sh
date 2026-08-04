#!/bin/bash
# Installs the scanner binaries the RunnerProvider uses in binary mode (see
# src/services/runner/). Without these the image still starts, but every scan
# reports `unavailable` instead of a result.
#
# Versions are pinned. A scanner that silently changes version between builds
# changes its findings between builds, which makes results irreproducible and a
# regression impossible to attribute. Override a *_VERSION to bump one
# deliberately.
#
# This runs from npm postinstall, so it executes on developer machines and in CI
# too — where pip3/curl may be absent and none of this is wanted. It is
# therefore best-effort by default and only fails the command when
# SCORPION_REQUIRE_TOOLS=1, which the Docker production stage sets. That way a
# laptop `npm install` still succeeds, while an image that would ship without
# working scanners fails the build instead.
set -uo pipefail

REQUIRE_TOOLS="${SCORPION_REQUIRE_TOOLS:-0}"

# 0.58.1 was unreachable: Aqua prunes old GitHub release tarballs, and every
# version below 0.69.3 now 404s, which made this script fail and (correctly)
# refuse to build the image. 0.69.3 is the oldest that still resolves and is
# already the pin used by functions/trivy-scanner, so this adds no new version
# to the tree. The Docker Hub channel is unaffected by the pruning, so the
# offline scanner bake in docker/scanners/ is not impacted by this.
TRIVY_VERSION="${TRIVY_VERSION:-0.69.3}"
GITLEAKS_VERSION="${GITLEAKS_VERSION:-8.30.1}"
SEMGREP_VERSION="${SEMGREP_VERSION:-1.101.0}"
CHECKOV_VERSION="${CHECKOV_VERSION:-3.2.334}"
BANDIT_VERSION="${BANDIT_VERSION:-1.8.0}"

BIN_DIR="${SCORPION_BIN_DIR:-/usr/local/bin}"
mkdir -p "$BIN_DIR"

OS=$(uname -s | tr '[:upper:]' '[:lower:]')
ARCH=$(uname -m)
case "$ARCH" in
  x86_64)        TRIVY_ARCH=64bit; GITLEAKS_ARCH=x64 ;;
  aarch64|arm64) TRIVY_ARCH=ARM64; GITLEAKS_ARCH=arm64 ;;
  *)
    echo "Unsupported architecture: $ARCH" >&2
    [ "$REQUIRE_TOOLS" = "1" ] && exit 1
    exit 0
    ;;
esac
# Trivy's release assets capitalise the OS segment (Linux/macOS).
TRIVY_OS=$(echo "$OS" | sed 's/^linux$/Linux/; s/^darwin$/macOS/')

echo "Installing security scanning tools into $BIN_DIR..."

echo "  trivy ${TRIVY_VERSION}"
curl -sSfL "https://github.com/aquasecurity/trivy/releases/download/v${TRIVY_VERSION}/trivy_${TRIVY_VERSION}_${TRIVY_OS}-${TRIVY_ARCH}.tar.gz" \
  | tar -xz -C "$BIN_DIR" trivy

echo "  gitleaks ${GITLEAKS_VERSION}"
curl -sSfL "https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}/gitleaks_${GITLEAKS_VERSION}_${OS}_${GITLEAKS_ARCH}.tar.gz" \
  | tar -xz -C "$BIN_DIR" gitleaks

# semgrep, checkov and bandit are Python tools. checkov and bandit were missing
# entirely: the scan orchestrator runs both on a full scan, so without them
# those stages report `unavailable` on every deployment.
echo "  semgrep ${SEMGREP_VERSION}, checkov ${CHECKOV_VERSION}, bandit ${BANDIT_VERSION}"
pip3 install --no-cache-dir --break-system-packages \
  "semgrep==${SEMGREP_VERSION}" \
  "checkov==${CHECKOV_VERSION}" \
  "bandit==${BANDIT_VERSION}"

# Fail the build rather than ship an image whose scanners do nothing. The
# failure this guards against is a scan reporting "no findings" because the
# tool was never installed.
echo "Verifying installs..."
MISSING=""
for tool in trivy gitleaks semgrep checkov bandit; do
  if command -v "$tool" >/dev/null 2>&1; then
    echo "  OK   $tool"
  else
    echo "  MISS $tool not found on PATH" >&2
    MISSING="$MISSING $tool"
  fi
done

if [ -n "$MISSING" ] && [ "$REQUIRE_TOOLS" = "1" ]; then
  echo "Refusing to build an image without:$MISSING" >&2
  exit 1
fi
if [ -n "$MISSING" ]; then
  echo "Note: missing scanners ($MISSING) will report 'unavailable' at scan time, never 'clean'." >&2
fi
exit 0
