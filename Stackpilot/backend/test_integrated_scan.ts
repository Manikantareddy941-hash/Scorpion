import { orchestrateScan } from './src/services/scan/orchestrator';
import { parseSemgrep, parseGitleaks, parseTrivy } from './src/services/scan/parsers';
import * as path from 'path';

async function testIntegrated() {
    const repoPath = path.resolve(process.cwd(), 'test-repo');
    console.log('🚀 Testing scanners against:', repoPath);
    console.time('concurrent-scan');

    const rawResults = await orchestrateScan(repoPath);
    console.timeEnd('concurrent-scan');

    console.log(`\n[Test] Received ${rawResults.length} tool results from orchestrator.`);
    if (rawResults.length > 0) {
        console.log('Raw Results Tools:', rawResults.map(r => r.tool).join(', '));
    }

    rawResults.forEach(res => {
        console.log(`\n--- Tool: ${res.tool} ---`);
        console.log('STDOUT Length:', res.stdout.length);
        if (res.stdout) {
            console.log('STDOUT Sample (100 chars):', res.stdout.substring(0, 100));
        } else {
            console.log('STDOUT is EMPTY');
        }

        if (res.stderr) {
            console.log('STDERR Sample (100 chars):', res.stderr.substring(0, 100));
        }

        let findings = [];
        try {
            if (res.tool === 'semgrep') findings = parseSemgrep(res.stdout);
            if (res.tool === 'gitleaks') findings = parseGitleaks(res.stdout);
            if (res.tool === 'trivy') findings = parseTrivy(res.stdout);
        } catch (e: any) {
            console.error(`[Test] Error parsing ${res.tool} results:`, e.message);
            console.log(`[Test] ${res.tool} raw stdout length:`, res.stdout.length);
        }

        console.log(`Findings count for ${res.tool}: ${findings.length}`);
        if (findings.length > 0) {
            console.log('First Finding:', JSON.stringify(findings[0], null, 2));
        }
    });
}

testIntegrated().catch(err => {
    console.error('Test Execution Failed:', err);
});
