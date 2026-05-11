#!/bin/bash
echo "Installing security scanning tools..."

# Install Trivy
curl -sfL https://raw.githubusercontent.com/aquasecurity/trivy/main/contrib/install.sh | sh -s -- -b /usr/local/bin

# Install Semgrep
pip3 install semgrep --break-system-packages

# Install Gitleaks
curl -sSfL https://github.com/gitleaks/gitleaks/releases/latest/download/gitleaks_$(uname -s)_$(uname -m).tar.gz | tar -xz -C /usr/local/bin gitleaks

# Verify installs
echo "Trivy: $(trivy --version 2>/dev/null || echo 'NOT FOUND')"
echo "Semgrep: $(semgrep --version 2>/dev/null || echo 'NOT FOUND')"
echo "Gitleaks: $(gitleaks version 2>/dev/null || echo 'NOT FOUND')"
