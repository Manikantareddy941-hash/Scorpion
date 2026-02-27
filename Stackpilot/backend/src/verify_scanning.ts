import * as path from 'path';
import { orchestrateScan } from './services/scan/orchestrator';
import { parseSemgrep, parseGitleaks, parseTrivy } from './services/scan/parsers';

async function verifyScanning() {
    console.log('🚀 Starting Verification: Security Scan Orchestration (TS)');

    // For verification, we'll scan the project's own src directory
    const testPath = path.join(__dirname, 'services/scan');
    console.log(`\n--- 1. Testing Orchestrator on: ${testPath} ---`);

    try {
        console.log('Orchestrating scans (Semgrep, Gitleaks, Trivy)...');
        const results = await orchestrateScan(testPath);
        console.log(`✅ Orchestrator returned ${results.length} tool results.`);

        results.forEach(res => {
            console.log(`\nTool: ${res.tool}`);
            let findings: any[] = [];
            if (res.tool === 'semgrep') findings = parseSemgrep(res.stdout);
            if (res.tool === 'gitleaks') findings = parseGitleaks(res.stdout);
            if (res.tool === 'trivy') findings = parseTrivy(res.stdout);

            console.log(`   Findings Count: ${findings.length}`);
            if (findings.length > 0) {
                console.log(`   Sample Finding: ${findings[0].message}`);
            } else {
                console.log('   (No findings detected or tool output empty)');
            }
        });

        console.log('\n✨ Security Scan Orchestration Verified! ✨');
    } catch (err: any) {
        console.error('\n❌ Scanning Verification Failed:', err.message);
    }
}

verifyScanning();
