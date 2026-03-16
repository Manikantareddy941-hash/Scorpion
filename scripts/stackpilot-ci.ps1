param (
    [Parameter(Mandatory=$true)]
    [string]$ApiBase,

    [Parameter(Mandatory=$true)]
    [string]$CiToken,

    [Parameter(Mandatory=$true)]
    [string]$RepoUrl
)

Write-Host "🚀 Triggering StackPilot Security Scan for: $RepoUrl" -ForegroundColor Cyan

# 1. Trigger Scan
$body = @{
    repo_url = $RepoUrl
} | ConvertTo-Json

try {
    $response = Invoke-RestMethod -Uri "$ApiBase/api/ci/scan" -Method Post -Headers @{ "X-API-KEY" = $CiToken } -ContentType "application/json" -Body $body
    $scanId = $response.scan_id
} catch {
    Write-Host "❌ Failed to trigger scan. Error: $_" -ForegroundColor Red
    exit 1
}

if (-not $scanId) {
    Write-Host "❌ Failed to trigger scan. No scan_id returned." -ForegroundColor Red
    exit 1
}

Write-Host "✅ Scan queued. ID: $scanId" -ForegroundColor Green
Write-Host "⏳ Polling for results..." -ForegroundColor Yellow

# 2. Poll for results
$maxRetries = 60
$retryCount = 0

while ($retryCount -lt $maxRetries) {
    try {
        $statusRes = Invoke-RestMethod -Uri "$ApiBase/api/ci/scans/$scanId/status" -Method Get -Headers @{ "X-API-KEY" = $CiToken }
        
        if ($statusRes.finished -eq $true) {
            $pass = $statusRes.pass
            $status = $statusRes.status
            
            Write-Host ""
            Write-Host "🏁 Scan Finished with status: $status" -ForegroundColor Cyan
            
            if ($pass -eq $true) {
                Write-Host "✅ SECURITY CHECK PASSED. No critical vulnerabilities found." -ForegroundColor Green
                exit 0
            } else {
                Write-Host "❌ SECURITY CHECK FAILED. Critical vulnerabilities detected or scan failed." -ForegroundColor Red
                Write-Host "🔗 View details: $ApiBase/projects/$scanId" -ForegroundColor Cyan
                exit 1
            }
        }
    } catch {
        Write-Host "⚠️ Error polling status: $_" -ForegroundColor Yellow
    }

    Write-Host -NoNewline "."
    Start-Sleep -Seconds 10
    $retryCount++
}

Write-Host "❌ Timeout waiting for scan results." -ForegroundColor Red
exit 1
