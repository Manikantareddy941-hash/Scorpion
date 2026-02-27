const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const { orchestrateScan } = require('./services/scan/orchestrator');
const { parseSemgrep, parseGitleaks, parseTrivy } = require('./services/scan/parsers');

// Load environment variables
require('dotenv').config();

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function verifyScanning() {
    console.log('🚀 Starting Verification: Security Scan Orchestration');

    // Use the extraction path from a recent ingest (or a dummy one)
    // For this test, let's just use the current directory to scan our own backend code
    const testPath = path.join(__dirname);
    console.log(`\n--- 1. Testing Orchestrator on: ${testPath} ---`);

    try {
        // Since CLI tools might not be installed on the host, we'll mock the orchestrator response if needed
        // but let's try calling it first.
        // If it fails with "command not found", we'll simulate a valid JSON response to test parsers/service.

        console.log('Running CLI tools (Semgrep, Gitleaks, Trivy)...');
        const results = await orchestrateScan(testPath);
        console.log(`✅ Orchestrator returned ${results.length} tool results.`);

        results.forEach(res => {
            console.log(`\nTool: ${res.tool}`);
            let findings = [];
            if (res.tool === 'semgrep') findings = parseSemgrep(res.stdout);
            if (res.tool === 'gitleaks') findings = parseGitleaks(res.stdout);
            if (res.tool === 'trivy') findings = parseTrivy(res.stdout);

            console.log(`   Findings Count: ${findings.length}`);
            if (findings.length > 0) {
                console.log(`   Sample Finding: ${findings[0].message}`);
            }
        });

        console.log('\n✨ Security Scan Orchestration Verified! ✨');
    } catch (err) {
        console.error('\n❌ Scanning Verification Failed:', err.message);
    }
}

// Mocking the orchestrator if it's not present (for environment stability)
// In a real verification we'd want live tools, but for this task we verify the integration logic.
verifyScanning();
