import { databases, DB_ID, COLLECTIONS, ID } from './appwrite';

// Realistic threat feed (12 entries)
export const MOCK_THREATS = [
    { $id: 'threat-1', title: 'Suspicious outbound SSH connection to rogue IP', severity: 'HIGH', type: 'network', details: 'Ip 185.220.101.5 (Tor Exit Node) on port 22.', status: 'open', $createdAt: new Date(Date.now() - 3600000).toISOString() },
    { $id: 'threat-2', title: 'Unauthorized IAM AssumeRole event in production', severity: 'HIGH', type: 'iam', details: 'Role assumed by developer-temp-session from unsanctioned region.', status: 'open', $createdAt: new Date(Date.now() - 7200000).toISOString() },
    { $id: 'threat-3', title: 'falco: Container drift detected in front-end pod', severity: 'HIGH', type: 'compliance', details: 'New executable written to /tmp/shell.sh and executed.', status: 'open', $createdAt: new Date(Date.now() - 10800000).toISOString() },
    { $id: 'threat-4', title: 'Kubernetes API Server brute-force attempt', severity: 'MEDIUM', type: 'network', details: '142 failed authorization requests from anonymous user.', status: 'open', $createdAt: new Date(Date.now() - 14400000).toISOString() },
    { $id: 'threat-5', title: 'AWS S3 bucket policy changed to public-read', severity: 'MEDIUM', type: 'compliance', details: 'Bucket: scorpion-intel-reports modified by admin session.', status: 'resolved', $createdAt: new Date(Date.now() - 18000000).toISOString() },
    { $id: 'threat-6', title: 'SQL injection attempt pattern on login endpoint', severity: 'MEDIUM', type: 'application', details: 'Request contained quote-based payload: UNION SELECT...', status: 'open', $createdAt: new Date(Date.now() - 21600000).toISOString() },
    { $id: 'threat-7', title: 'Stale SSH keys in authorized_keys', severity: 'LOW', type: 'iam', details: 'Key for operator "tony" not rotated in over 180 days.', status: 'open', $createdAt: new Date(Date.now() - 25200000).toISOString() },
    { $id: 'threat-8', title: 'TLS certificate expiring in 14 days', severity: 'LOW', type: 'compliance', details: 'Domain api-dev.scorpion.io uses Let\'s Encrypt standard certificate.', status: 'open', $createdAt: new Date(Date.now() - 28800000).toISOString() },
    { $id: 'threat-9', title: 'Dependency vulnerability: lodash (<4.17.21)', severity: 'LOW', type: 'dependency', details: 'CVE-2021-23337 command injection vulnerability in lodash.', status: 'resolved', $createdAt: new Date(Date.now() - 32400000).toISOString() },
    { $id: 'threat-10', title: 'Cryptomining pool DNS lookup detected', severity: 'HIGH', type: 'network', details: 'Request to pool.supportxmr.com blocked by Core DNS Guard.', status: 'resolved', $createdAt: new Date(Date.now() - 36000000).toISOString() },
    { $id: 'threat-11', title: 'Secrets leaked: Plaintext token found in README.md', severity: 'HIGH', type: 'application', details: 'Slack Bot Token (xoxb-...) leaked in commit 3e9d8a1.', status: 'open', $createdAt: new Date(Date.now() - 39600000).toISOString() },
    { $id: 'threat-12', title: 'Falco: Ingress controller reading sensitive host file', severity: 'MEDIUM', type: 'compliance', details: 'Attempted read on /etc/shadow by ingress-nginx process.', status: 'open', $createdAt: new Date(Date.now() - 43200000).toISOString() }
];

// Repositories (3 repos)
export const MOCK_REPOSITORIES = [
    { $id: 'repo-fit-track', name: 'FIT_TRACK', url: 'https://github.com/scorpion-demo/fit-track', status: 'blocked', user_id: 'demo-user', $createdAt: new Date().toISOString() },
    { $id: 'repo-food-delivery', name: 'FOOD-DELIVERY-APP', url: 'https://github.com/scorpion-demo/food-delivery-app', status: 'passing', user_id: 'demo-user', $createdAt: new Date().toISOString() },
    { $id: 'repo-scorpion-platform', name: 'SCORPION', url: 'https://github.com/scorpion-demo/scorpion', status: 'review', user_id: 'demo-user', $createdAt: new Date().toISOString() }
];

// Open findings (8 open findings)
export const MOCK_FINDINGS = [
    { $id: 'find-1', title: 'SQL Injection in user authentication routing', severity: 'CRITICAL', category: 'sast', repo_id: 'repo-fit-track', file_path: 'src/controllers/auth.ts', status: 'open', rule_id: 'sast-sql-injection', $createdAt: new Date().toISOString() },
    { $id: 'find-2', title: 'Plaintext AWS Access Key found in server config', severity: 'CRITICAL', category: 'sast', repo_id: 'repo-fit-track', file_path: 'config/aws.json', status: 'open', rule_id: 'sast-hardcoded-secret', $createdAt: new Date().toISOString() },
    { $id: 'find-3', title: 'Cross-Site Scripting (XSS) in search controller', severity: 'HIGH', category: 'sast', repo_id: 'repo-scorpion-platform', file_path: 'src/components/SearchBox.tsx', status: 'open', rule_id: 'sast-stored-xss', $createdAt: new Date().toISOString() },
    { $id: 'find-4', title: 'Outdated vulnerable lodash version (CVE-2021-23337)', severity: 'HIGH', category: 'dependency', repo_id: 'repo-scorpion-platform', file_path: 'package.json', status: 'open', rule_id: 'dep-lodash-cve', $createdAt: new Date().toISOString() },
    { $id: 'find-5', title: 'Missing security headers in nginx router ingress', severity: 'MEDIUM', category: 'dast', repo_id: 'repo-scorpion-platform', file_path: 'ingress/nginx.conf', status: 'open', rule_id: 'dast-missing-headers', $createdAt: new Date().toISOString() },
    { $id: 'find-6', title: 'Insecure cookie flags (Missing Secure/HttpOnly)', severity: 'MEDIUM', category: 'dast', repo_id: 'repo-fit-track', file_path: 'src/server.ts', status: 'open', rule_id: 'dast-insecure-cookie', $createdAt: new Date().toISOString() },
    { $id: 'find-7', title: 'Path traversal vulnerability in static file router', severity: 'HIGH', category: 'sast', repo_id: 'repo-fit-track', file_path: 'src/routes/static.ts', status: 'open', rule_id: 'sast-path-traversal', $createdAt: new Date().toISOString() },
    { $id: 'find-8', title: 'Weak cipher suite enabled in TLS endpoint', severity: 'LOW', category: 'dast', repo_id: 'repo-scorpion-platform', file_path: 'infra/terraform/elb.tf', status: 'open', rule_id: 'dast-weak-ciphers', $createdAt: new Date().toISOString() }
];

// Scans (2 completed scan results with realistic pass/fail breakdown)
export const MOCK_SCANS = [
    {
        $id: 'scan-1',
        repo_id: 'repo-fit-track',
        repoUrl: 'https://github.com/scorpion-demo/fit-track',
        status: 'completed',
        gateStatus: 'blocked',
        gate_status: 'blocked',
        criticalCount: 2,
        highCount: 1,
        mediumCount: 1,
        lowCount: 0,
        bugs: 2,
        vulnerabilities: 4,
        security_score: 68,
        security_rating: 68,
        details: JSON.stringify({
            critical_count: 2,
            high_count: 1,
            medium_count: 1,
            low_count: 0,
            total_vulnerabilities: 4,
            security_score: 68,
            bugs: 2,
            total_lines: 48500,
            gate_status: 'blocked'
        }),
        $createdAt: new Date(Date.now() - 3600000 * 2).toISOString()
    },
    {
        $id: 'scan-2',
        repo_id: 'repo-food-delivery',
        repoUrl: 'https://github.com/scorpion-demo/food-delivery-app',
        status: 'completed',
        gateStatus: 'passed',
        gate_status: 'passed',
        criticalCount: 0,
        highCount: 0,
        mediumCount: 2,
        lowCount: 2,
        bugs: 0,
        vulnerabilities: 4,
        security_score: 73,
        security_rating: 73,
        details: JSON.stringify({
            critical_count: 0,
            high_count: 0,
            medium_count: 2,
            low_count: 2,
            total_vulnerabilities: 4,
            security_score: 73,
            bugs: 0,
            total_lines: 32000,
            gate_status: 'passed'
        }),
        $createdAt: new Date(Date.now() - 3600000 * 5).toISOString()
    }
];

// Test runs (Issue 4 - 2 historical scan results)
export const MOCK_TEST_RUNS = [
    {
        $id: 'test-1',
        repo_id: 'repo-food-delivery',
        scan_type: 'SAST',
        total_tests: 124,
        passed_tests: 124,
        failed_tests: 0,
        pass_rate: 100,
        coverage: 84.5,
        status: 'completed',
        timestamp: new Date(Date.now() - 3600000 * 5).toISOString(),
        $createdAt: new Date(Date.now() - 3600000 * 5).toISOString()
    },
    {
        $id: 'test-2',
        repo_id: 'repo-fit-track',
        scan_type: 'DAST',
        total_tests: 95,
        passed_tests: 87,
        failed_tests: 8,
        pass_rate: 91.5,
        coverage: 62.1,
        status: 'completed',
        timestamp: new Date(Date.now() - 3600000 * 2).toISOString(),
        $createdAt: new Date(Date.now() - 3600000 * 2).toISOString()
    }
];

export async function seedDemoData() {
    console.log('[Seed] Seeding realistic demo data...');
    try {
        // Proactively scan for and update any historical scans with excessive counts (e.g. 44 high count) to prevent clamping to 0%
        try {
            const { Query } = await import('./appwrite');
            const existingScans = await databases.listDocuments(DB_ID, COLLECTIONS.SCANS, [
                Query.limit(100)
            ]);
            for (const scanDoc of existingScans.documents) {
                if (!scanDoc.$id.startsWith('scan-')) continue; // Skip real/Appwrite-generated IDs to avoid mutating real production data
                const crit = Number(scanDoc.criticalCount ?? 0);
                const high = Number(scanDoc.highCount ?? 0);
                if (crit >= 1 || high >= 20) {
                    console.log(`[Seed] Found scan with excessive counts (${scanDoc.$id}), updating to demo-friendly numbers...`);
                    await databases.updateDocument(DB_ID, COLLECTIONS.SCANS, scanDoc.$id, {
                        criticalCount: 0,
                        highCount: 3,
                        mediumCount: 8,
                        lowCount: 12,
                        vulnerabilities: 23,
                        security_score: 82
                    });
                }
            }
        } catch (scanErr: any) {
            console.log('[Seed] Could not filter/update existing scans:', scanErr.message);
        }

        // We write to Appwrite collections if possible
        for (const repo of MOCK_REPOSITORIES) {
            try {
                await databases.getDocument(DB_ID, COLLECTIONS.REPOSITORIES, repo.$id);
                // Document exists, skip silently
            } catch (err) {
                await databases.createDocument(DB_ID, COLLECTIONS.REPOSITORIES, repo.$id, {
                    name: repo.name,
                    url: repo.url,
                    user_id: repo.user_id,
                    created_at: repo.$createdAt || new Date().toISOString()
                }).catch(createErr => console.log(`[Seed] Repo ${repo.name} create error:`, createErr.message));
            }
        }

        for (const scan of MOCK_SCANS) {
            try {
                await databases.getDocument(DB_ID, COLLECTIONS.SCANS, scan.$id);
                // Document exists, skip silently
            } catch (err) {
                await databases.createDocument(DB_ID, COLLECTIONS.SCANS, scan.$id, {
                    repo_id: scan.repo_id,
                    repoUrl: scan.repoUrl,
                    status: scan.status,
                    gateStatus: scan.gateStatus,
                    criticalCount: scan.criticalCount,
                    highCount: scan.highCount,
                    mediumCount: scan.mediumCount,
                    lowCount: scan.lowCount,
                    details: scan.details,
                    scan_type: 'SAST',
                    timestamp: scan.$createdAt || new Date().toISOString(),
                    scannerVersion: '1.0.0'
                }).catch(createErr => console.log(`[Seed] Scan ${scan.$id} create error:`, createErr.message));
            }
        }

        for (const find of MOCK_FINDINGS) {
            try {
                await databases.getDocument(DB_ID, COLLECTIONS.FINDINGS, find.$id);
                // Document exists, skip silently
            } catch (err) {
                await databases.createDocument(DB_ID, COLLECTIONS.FINDINGS, find.$id, {
                    scanId: 'scan-1',
                    title: find.title,
                    severity: find.severity,
                    package: 'source',
                    installedVersion: '1.0.0',
                    description: find.title,
                    repo_id: find.repo_id,
                    repo_name: find.repo_id === 'repo-fit-track' ? 'FIT_TRACK' : 'SCORPION',
                    file_path: find.file_path,
                    status: find.status,
                    type: find.category,
                    created_at: find.$createdAt || new Date().toISOString()
                }).catch(createErr => console.log(`[Seed] Finding ${find.$id} create error:`, createErr.message));
            }
        }

        for (const run of MOCK_TEST_RUNS) {
            try {
                await databases.getDocument(DB_ID, COLLECTIONS.TEST_RUNS, run.$id);
                // Document exists, skip silently
            } catch (err) {
                await databases.createDocument(DB_ID, COLLECTIONS.TEST_RUNS, run.$id, {
                    repo_id: run.repo_id,
                    repo_name: run.repo_id === 'repo-fit-track' ? 'FIT_TRACK' : 'FOOD-DELIVERY-APP',
                    status: run.status,
                    total_tests: run.total_tests,
                    passed_tests: run.passed_tests,
                    failed_tests: run.failed_tests,
                    skipped_tests: 0,
                    coverage: run.coverage ? Math.round(run.coverage) : 0,
                    timestamp: run.timestamp || new Date().toISOString()
                }).catch(createErr => console.log(`[Seed] Test run ${run.$id} create error:`, createErr.message));
            }
        }

        for (const threat of MOCK_THREATS) {
            try {
                await databases.getDocument(DB_ID, COLLECTIONS.THREATS, threat.$id);
                // Document exists, skip silently
            } catch (err) {
                await databases.createDocument(DB_ID, COLLECTIONS.THREATS, threat.$id, {
                    rule: threat.title,
                    priority: threat.severity,
                    containerId: 'ct-scorpion-demo',
                    output: threat.details || threat.title,
                    status: threat.status,
                    timestamp: threat.$createdAt || new Date().toISOString()
                }).catch(createErr => console.log(`[Seed] Threat ${threat.$id} create error:`, createErr.message));
            }
        }

    } catch (e: any) {
        console.error('[Seed] Database write error, using local storage fallback:', e.message);
    }

    // Always seed local storage so the fallback works
    localStorage.setItem('scorpion_demo_seeded', 'true');
    localStorage.setItem('scorpion_onboarded', 'true');
    console.log('[Seed] Demo data seeding completed successfully!');
}
