#!/usr/bin/env bash

echo "Installing Security Toolchain..."

OS="$(uname)"

if [[ "$OS" == "Darwin" ]]; then
echo "MacOS detected"
brew install semgrep
brew install gitleaks
brew install trivy

elif [[ "$OS" == "Linux" ]]; then
echo "Linux detected"
pip install semgrep
wget https://github.com/gitleaks/gitleaks/releases/latest/download/gitleaks-linux-amd64 -O gitleaks
chmod +x gitleaks
sudo mv gitleaks /usr/local/bin/

sudo apt-get update
sudo apt-get install -y wget apt-transport-https gnupg lsb-release
wget -qO - https://aquasecurity.github.io/trivy-repo/deb/public.key | sudo apt-key add -
echo deb https://aquasecurity.github.io/trivy-repo/deb $(lsb_release -sc) main | sudo tee /etc/apt/sources.list.d/trivy.list
sudo apt-get update
sudo apt-get install trivy

elif [[ "$OS" == "MINGW"* || "$OS" == "MSYS"* ]]; then
echo "Windows detected"
choco install semgrep -y
choco install gitleaks -y
choco install trivy -y
else
echo "Unsupported OS"
fi

echo "Installation complete"
