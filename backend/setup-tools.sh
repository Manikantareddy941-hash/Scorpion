#!/bin/bash
echo "Installing security scanning tools..."

# Install Trivy
curl -sfL https://raw.githubusercontent.com/aquasecurity/trivy/main/contrib/install.sh | sh -s -- -b /usr/local/bin

# Install Semgrep
pip3 install semgrep --break-system-packages

# Install Gitleaks (asset names embed the version, e.g. gitleaks_8.30.1_linux_x64.tar.gz,
# so "latest/download" can't be used directly - resolve the version first)
GITLEAKS_OS=$(uname -s | tr '[:upper:]' '[:lower:]')
GITLEAKS_ARCH=$(uname -m)
case "$GITLEAKS_ARCH" in
  x86_64) GITLEAKS_ARCH=x64 ;;
  aarch64|arm64) GITLEAKS_ARCH=arm64 ;;
esac
GITLEAKS_VERSION=$(curl -sSfL https://api.github.com/repos/gitleaks/gitleaks/releases/latest | grep -m1 '"tag_name"' | cut -d'"' -f4 | sed 's/^v//')
curl -sSfL "https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}/gitleaks_${GITLEAKS_VERSION}_${GITLEAKS_OS}_${GITLEAKS_ARCH}.tar.gz" | tar -xz -C /usr/local/bin gitleaks

# Verify installs
echo "Trivy: $(trivy --version 2>/dev/null || echo 'NOT FOUND')"
echo "Semgrep: $(semgrep --version 2>/dev/null || echo 'NOT FOUND')"
echo "Gitleaks: $(gitleaks version 2>/dev/null || echo 'NOT FOUND')"
