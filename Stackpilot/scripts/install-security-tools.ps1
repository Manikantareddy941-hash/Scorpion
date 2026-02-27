Write-Host "Installing Security Toolchain..." -ForegroundColor Cyan

if ($IsWindows -or $env:OS -like "*Windows*") {
    Write-Host "Windows detected" -ForegroundColor Green
    
    # Check for Chocolatey
    if (!(Get-Command choco -ErrorAction SilentlyContinue)) {
        Write-Host "Chocolatey not found. Please install it from https://chocolatey.org/install" -ForegroundColor Red
        exit 1
    }

    Write-Host "Installing Semgrep..."
    choco install semgrep -y
    
    Write-Host "Installing Gitleaks..."
    choco install gitleaks -y
    
    Write-Host "Installing Trivy..."
    choco install trivy -y
}
elseif ($IsMacOS) {
    Write-Host "MacOS detected" -ForegroundColor Green
    brew install semgrep gitleaks trivy
}
else {
    Write-Host "Linux detected" -ForegroundColor Green
    sudo apt-get update
    sudo apt-get install -y wget apt-transport-https gnupg lsb-release pip
    
    pip install semgrep
    
    # Gitleaks
    wget https://github.com/gitleaks/gitleaks/releases/latest/download/gitleaks-linux-amd64 -O gitleaks
    chmod +x gitleaks
    sudo mv gitleaks /usr/local/bin/
    
    # Trivy
    wget -qO - https://aquasecurity.github.io/trivy-repo/deb/public.key | sudo apt-key add -
    echo deb https://aquasecurity.github.io/trivy-repo/deb $(ls_release -sc) main | sudo tee /etc/apt/sources.list.d/trivy.list
    sudo apt-get update
    sudo apt-get install trivy -y
}

Write-Host "Installation complete" -ForegroundColor Green
