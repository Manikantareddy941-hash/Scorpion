#!/bin/bash

# StackPilot CI Runner
# Usage: ./stackpilot-ci.sh <API_BASE_URL> <CI_TOKEN> <REPO_URL>

API_BASE=$1
CI_TOKEN=$2
REPO_URL=$3

if [ -z "$API_BASE" ] || [ -z "$CI_TOKEN" ] || [ -z "$REPO_URL" ]; then
    echo "❌ Usage: ./stackpilot-ci.sh <API_BASE_URL> <CI_TOKEN> <REPO_URL>"
    exit 1
fi

echo "🚀 Triggering StackPilot Security Scan for: $REPO_URL"

# 1. Trigger Scan
RESPONSE=$(curl -s -X POST "$API_BASE/api/ci/scan" \
    -H "X-API-KEY: $CI_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"repo_url\": \"$REPO_URL\"}")

SCAN_ID=$(echo $RESPONSE | grep -o '"scan_id":"[^"]*' | cut -d'"' -f4)

if [ -z "$SCAN_ID" ]; then
    echo "❌ Failed to trigger scan. Response: $RESPONSE"
    exit 1
fi

echo "✅ Scan queued. ID: $SCAN_ID"
echo "⏳ Polling for results..."

# 2. Poll for results
MAX_RETRIES=60
RETRY_COUNT=0

while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do
    STATUS_RES=$(curl -s -X GET "$API_BASE/api/ci/scans/$SCAN_ID/status" \
        -H "X-API-KEY: $CI_TOKEN")
    
    FINISHED=$(echo $STATUS_RES | grep -o '"finished":[^,]*' | cut -d':' -f2)
    
    if [ "$FINISHED" == "true" ]; then
        PASS=$(echo $STATUS_RES | grep -o '"pass":[^,]*' | cut -d':' -f2)
        STATUS=$(echo $STATUS_RES | grep -o '"status":"[^"]*' | cut -d'"' -f4)
        
        echo ""
        echo "🏁 Scan Finished with status: $STATUS"
        
        if [ "$PASS" == "true" ]; then
            echo "✅ SECURITY CHECK PASSED. No critical vulnerabilities found."
            exit 0
        else
            echo "❌ SECURITY CHECK FAILED. Critical vulnerabilities detected or scan failed."
            echo "🔗 View details: $API_BASE/projects/$SCAN_ID"
            exit 1
        fi
    fi

    printf "."
    sleep 10
    RETRY_COUNT=$((RETRY_COUNT+1))
done

echo "❌ Timeout waiting for scan results."
exit 1
