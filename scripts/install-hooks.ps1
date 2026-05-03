# SCORPION Hook Installer (PowerShell)
# -------------------------

$hookSrc = "scripts/hooks/pre-commit"
$hookDest = ".git/hooks/pre-commit"

if (-not (Test-Path $hookSrc)) {
    Write-Host "Error: $hookSrc not found. Run this script from the project root." -ForegroundColor Red
    exit 1
}

if (-not (Test-Path ".git")) {
    Write-Host "Error: .git directory not found. Are you in the project root?" -ForegroundColor Red
    exit 1
}

Write-Host "Installing SCORPION pre-commit hook..." -ForegroundColor Cyan
Copy-Item $hookSrc $hookDest -Force

Write-Host "Success! SCORPION pre-commit hook is now active." -ForegroundColor Green
Write-Host "Every time you commit, SCORPION will check for secrets and vulnerabilities." -ForegroundColor Green
