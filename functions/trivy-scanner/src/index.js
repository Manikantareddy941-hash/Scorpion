import { Client, Databases, ID, Query } from 'node-appwrite';
import https from 'https';
import http from 'http';
import { URL } from 'url';
import fs from 'fs';
import zlib from 'zlib';
import tar from 'tar';
import { execSync } from 'child_process';
import path from 'path';

const TRIVY_URL = 'https://github.com/aquasecurity/trivy/releases/download/v0.69.3/trivy_0.69.3_Linux-64bit.tar.gz';
const TRIVY_DIR = '/trivy-bin';
const TRIVY_PATH = `${TRIVY_DIR}/trivy`;

function download(url, destPath) {
    return new Promise((resolve, reject) => {
        let redirectCount = 0;
        const follow = (location) => {
            if (redirectCount++ > 15) return reject(new Error('Too many redirects'));
            let parsed;
            try { parsed = new URL(location); } catch (e) { return reject(new Error(`Invalid redirect URL: ${location}`)); }
            const transport = parsed.protocol === 'https:' ? https : http;
            transport.get(location, (res) => {
                if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
                    const next = res.headers.location;
                    if (!next) return reject(new Error('Redirect with no Location header'));
                    const nextUrl = next.startsWith('http') ? next : new URL(next, location).href;
                    res.resume();
                    return follow(nextUrl);
                }
                if (res.statusCode !== 200) return reject(new Error(`Download failed: HTTP ${res.statusCode}`));
                const file = fs.createWriteStream(destPath);
                res.pipe(file);
                file.on('finish', () => file.close(resolve));
                file.on('error', (err) => { fs.unlink(destPath, () => {}); reject(err); });
            }).on('error', reject);
        };
        follow(url);
    });
}

async function ensureTrivy(log) {
    if (fs.existsSync(TRIVY_PATH)) return;
    fs.mkdirSync(TRIVY_DIR, { recursive: true });
    log('Downloading latest Trivy release...');
    const tgzPath = `${TRIVY_DIR}/trivy.tar.gz`;
    await download(TRIVY_URL, tgzPath);
    await new Promise((resolve, reject) => {
        fs.createReadStream(tgzPath)
            .pipe(zlib.createGunzip())
            .pipe(tar.extract({ cwd: TRIVY_DIR, filter: (p) => p === 'trivy' }))
            .on('finish', resolve)
            .on('error', reject);
    });
    fs.unlinkSync(tgzPath);
    fs.chmodSync(TRIVY_PATH, 0o755);
    log('Trivy ready');
}

function ensureCheckov(log) {
    try {
        execSync('checkov --version');
    } catch {
        log('Installing checkov via pip...');
        try {
            execSync('pip3 install checkov --user', { stdio: 'pipe' });
            log('Checkov installed');
        } catch (e) {
            log('Failed to install checkov: ' + e.message);
        }
    }
}

export default async ({ req, res, log, error }) => {
    try { await ensureTrivy(log); } catch (err) {
        return res.json({ success: false, error: 'Trivy Init Failed: ' + err.message }, 500);
    }
    
    // Ensure checkov is available for policy evaluation
    ensureCheckov(log);

    let payload = {};
    try { payload = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {}); } catch (_) {}

    const repoUrl = payload.repoUrl;
    const visibility = payload.visibility || 'public';
    const userId = payload.userId;

    if (!repoUrl) return res.json({ success: false, error: 'repoUrl is required' }, 400);

    const client = new Client()
        .setEndpoint(process.env.APPWRITE_FUNCTION_API_ENDPOINT || process.env.VITE_APPWRITE_ENDPOINT || 'https://cloud.appwrite.io/v1')
        .setProject(process.env.APPWRITE_FUNCTION_PROJECT_ID || process.env.VITE_APPWRITE_PROJECT_ID)
        .setKey(process.env.APPWRITE_API_KEY);

    const databases = new Databases(client);
    const databaseId = process.env.VITE_APPWRITE_DATABASE_ID || process.env.APPWRITE_DATABASE_ID;
    const scansCollectionId = process.env.VITE_APPWRITE_SCANS_COLLECTION_ID || 'scans';
    const findingsCollectionId = process.env.VITE_APPWRITE_FINDINGS_COLLECTION_ID || 'findings';
    const policiesCollectionId = process.env.VITE_APPWRITE_POLICIES_COLLECTION_ID || 'policies';
    const integrationsCollectionId = process.env.VITE_APPWRITE_INTEGRATIONS_COLLECTION_ID || 'integrations';

    log(`Creating scan record for ${repoUrl}...`);
    let scanDoc = await databases.createDocument(databaseId, scansCollectionId, ID.unique(), {
        repo_id: repoUrl,
        status: 'scanning',
        scan_type: 'repository',
        repoUrl,
        visibility,
        timestamp: new Date().toISOString(),
        scannerVersion: '0.69.3',
        criticalCount: 0, highCount: 0, mediumCount: 0, lowCount: 0
    });

    let criticalCount = 0, highCount = 0, mediumCount = 0, lowCount = 0, policyViolationCount = 0;

    // === TRIVY SCAN ===
    log(`Running Trivy...`);
    let trivyOutput = '';
    try {
        trivyOutput = execSync(`${TRIVY_PATH} repo --format json ${repoUrl}`, { encoding: 'utf-8', maxBuffer: 50 * 1024 * 1024 });
    } catch (execErr) {
        trivyOutput = execErr.stdout ? execErr.stdout.toString() : '';
        if (!trivyOutput) log(`Trivy error warning: ${execErr.message}`);
    }

    try {
        const report = JSON.parse(trivyOutput);
        const results = report.Results || [];
        for (const result of results) {
            for (const vuln of (result.Vulnerabilities || [])) {
                const severity = (vuln.Severity || 'UNKNOWN').toUpperCase();
                if (severity === 'CRITICAL') criticalCount++;
                else if (severity === 'HIGH') highCount++;
                else if (severity === 'MEDIUM') mediumCount++;
                else if (severity === 'LOW') lowCount++;

                await databases.createDocument(databaseId, findingsCollectionId, ID.unique(), {
                    scanId: scanDoc.$id,
                    type: 'vulnerability',
                    title: (vuln.Title || vuln.VulnerabilityID || 'Unknown').substring(0, 255),
                    severity: severity.substring(0, 50),
                    package: (vuln.PkgName || 'Unknown').substring(0, 255),
                    installedVersion: (vuln.InstalledVersion || 'Unknown').substring(0, 255),
                    fixedVersion: (vuln.FixedVersion || '').substring(0, 255),
                    description: (vuln.Description || '').substring(0, 4999)
                });
            }
        }
    } catch (e) {
        log(`Trivy JSON parse issue: ${e.message}`);
    }

    // === CHECKOV POLICY SCAN ===
    if (userId) {
        log(`Starting Checkov Custom Policy Enforcement...`);
        const cloneDir = `/tmp/repo-${scanDoc.$id}`;
        const policiesDir = `/tmp/policies-${scanDoc.$id}`;
        
        try {
            // Fetch Custom Policies
            const policiesRes = await databases.listDocuments(databaseId, policiesCollectionId, [
                Query.equal('userId', userId),
                Query.equal('isActive', true)
            ]);

            if (policiesRes.total > 0) {
                // Determine checkov executable path (could be local to user)
                let checkovBin = 'checkov';
                try { checkovBin = execSync('python3 -m site --user-base').toString().trim() + '/bin/checkov'; } catch(e){}

                fs.mkdirSync(cloneDir, { recursive: true });
                fs.mkdirSync(policiesDir, { recursive: true });
                
                policiesRes.documents.forEach((p, idx) => {
                    fs.writeFileSync(path.join(policiesDir, `policy_${idx}.yaml`), p.code);
                });

                log(`Cloning repository for Checkov...`);
                execSync(`git clone ${repoUrl} ${cloneDir} --depth 1`, { stdio: 'pipe' });

                log(`Running Checkov...`);
                let checkovOutput = '';
                try {
                    checkovOutput = execSync(`${checkovBin} -d ${cloneDir} --external-checks-dir ${policiesDir} -o json`, { encoding: 'utf-8', maxBuffer: 50 * 1024 * 1024 });
                } catch (execErr) {
                    checkovOutput = execErr.stdout ? execErr.stdout.toString() : '';
                }

                if (checkovOutput) {
                    let cReport = [];
                    try {
                        let parsed = JSON.parse(checkovOutput);
                        cReport = Array.isArray(parsed) ? parsed : [parsed];
                    } catch (e) { log(`Checkov JSON parse error`); }
                    
                    for (const reportNode of cReport) {
                        const failedChecks = reportNode.results?.failed_checks || [];
                        for (const check of failedChecks) {
                            if (check.check_id && check.check_id.startsWith('CKV_')) {
                                mediumCount++;
                                policyViolationCount++;
                                try {
                                    await databases.createDocument(databaseId, findingsCollectionId, ID.unique(), {
                                        scanId: scanDoc.$id,
                                        type: 'policy_violation',
                                        title: check.check_name.substring(0, 255),
                                        severity: 'MEDIUM',
                                        package: check.resource.substring(0, 255),
                                        description: `Policy Violation: ${check.check_id}\nGuideline: ${check.guideline || 'None'}\nFile: ${check.file_path}`.substring(0, 4999),
                                        installedVersion: '',
                                        fixedVersion: ''
                                    });
                                } catch (err) { log(err.message); }
                            }
                        }
                    }
                }
            } else {
                log(`No active policies found for user ${userId}`);
            }
        } catch (policyErr) {
            log(`Policy enforcement error: ${policyErr.message}`);
        } finally {
            try { execSync(`rm -rf ${cloneDir} ${policiesDir}`); } catch(e){} // Cleanup
        }
    }

    log(`Scan complete — C:${criticalCount} H:${highCount} M:${mediumCount} L:${lowCount}`);
    await databases.updateDocument(databaseId, scansCollectionId, scanDoc.$id, {
        status: 'completed',
        criticalCount, highCount, mediumCount, lowCount
    });

    if ((criticalCount > 0 || policyViolationCount > 0) && userId) {
        log(`Triggering Discord Webhook payload engine...`);
        try {
            const integrations = await databases.listDocuments(databaseId, integrationsCollectionId, [
                Query.equal('userId', userId),
                Query.equal('isEnabled', true)
            ]);
            
            if (integrations.total > 0 && integrations.documents[0].webhookUrl) {
                const webhookUrl = integrations.documents[0].webhookUrl;
                const reportsUrl = process.env.VITE_APP_URL || 'http://localhost:5173/reports';
                
                const payload = {
                    embeds: [{
                        title: "🦂 SCORPION: Security Breach Detected!",
                        description: `**Repository Target:** ${repoUrl}\n\nA routine cloud infrastructure scan has intercepted unauthorized active risk matrices. Immediate remediation triage is requested.`,
                        color: 16711680,
                        fields: [
                            { name: "Critical Vulnerabilities", value: criticalCount.toString(), inline: true },
                            { name: "Policy Violations", value: policyViolationCount.toString(), inline: true }
                        ],
                        url: reportsUrl,
                        footer: {
                            text: `Scan Execution ID: ${scanDoc.$id}`
                        },
                        timestamp: new Date().toISOString()
                    }]
                };

                await fetch(webhookUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                log(`Direct payload beamed to Discord webhook successfully.`);
            }
        } catch (hookErr) {
            log(`Failed to transmit Discord webhook: ${hookErr.message}`);
        }
    }

    return res.json({
        success: true,
        scanId: scanDoc.$id,
        summary: { criticalCount, highCount, mediumCount, lowCount, total: criticalCount + highCount + mediumCount + lowCount }
    });
};
