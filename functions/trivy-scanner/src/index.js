import { Client, Databases, ID } from 'node-appwrite';
import https from 'https';
import http from 'http';
import { URL } from 'url';
import fs from 'fs';
import zlib from 'zlib';
import tar from 'tar';
import { execSync } from 'child_process';


const TRIVY_URL = 'https://github.com/aquasecurity/trivy/releases/download/v0.69.3/trivy_0.69.3_Linux-64bit.tar.gz';
const TRIVY_DIR = '/trivy-bin';
const TRIVY_PATH = `${TRIVY_DIR}/trivy`;

/** Download a URL to a local file, following redirects with auto http/https selection. */
function download(url, destPath) {
    return new Promise((resolve, reject) => {
        let redirectCount = 0;

        const follow = (location) => {
            if (redirectCount++ > 15) {
                return reject(new Error('Too many redirects'));
            }

            let parsed;
            try {
                parsed = new URL(location);
            } catch (e) {
                return reject(new Error(`Invalid redirect URL: ${location}`));
            }

            const transport = parsed.protocol === 'https:' ? https : http;

            transport.get(location, (res) => {
                if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 303 || res.statusCode === 307 || res.statusCode === 308) {
                    const next = res.headers.location;
                    if (!next) return reject(new Error('Redirect with no Location header'));
                    // Resolve relative redirects against the current URL
                    const nextUrl = next.startsWith('http') ? next : new URL(next, location).href;
                    res.resume(); // drain before following
                    return follow(nextUrl);
                }
                if (res.statusCode !== 200) {
                    return reject(new Error(`Download failed with HTTP ${res.statusCode} at ${location}`));
                }
                const file = fs.createWriteStream(destPath);
                res.pipe(file);
                file.on('finish', () => file.close(resolve));
                file.on('error', (err) => { fs.unlink(destPath, () => {}); reject(err); });
            }).on('error', reject);
        };

        follow(url);
    });
}


/** Download the Trivy .tar.gz and extract just the `trivy` binary to TRIVY_DIR. */
async function ensureTrivy(log) {
    if (fs.existsSync(TRIVY_PATH)) {
        log('Trivy already present at ' + TRIVY_PATH);
        return;
    }

    fs.mkdirSync(TRIVY_DIR, { recursive: true });
    log('Downloading latest Trivy release...');

    const tgzPath = `${TRIVY_DIR}/trivy.tar.gz`;
    await download(TRIVY_URL, tgzPath);
    log('Download complete. Extracting binary...');

    // Extract only the `trivy` binary from the tar.gz
    await new Promise((resolve, reject) => {
        fs.createReadStream(tgzPath)
            .pipe(zlib.createGunzip())
            .pipe(tar.extract({ cwd: TRIVY_DIR, filter: (p) => p === 'trivy' }))
            .on('finish', resolve)
            .on('error', reject);
    });

    fs.unlinkSync(tgzPath);
    fs.chmodSync(TRIVY_PATH, 0o755);
    log('Trivy ready at ' + TRIVY_PATH);
}

export default async ({ req, res, log, error }) => {
    // 1. Ensure Trivy binary is available (Node-native download)
    try {
        await ensureTrivy(log);
    } catch (err) {
        error('Failed to download Trivy: ' + err.message);
        return res.json({ success: false, error: 'Initialization failed: ' + err.message }, 500);
    }

    // 2. Parse request body
    let payload = {};
    try {
        payload = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    } catch (_) {}

    const repoUrl = payload.repoUrl;
    const visibility = payload.visibility || 'public';

    if (!repoUrl) {
        return res.json({ success: false, error: 'repoUrl is required' }, 400);
    }

    // 3. Initialize Appwrite client
    const client = new Client()
        .setEndpoint(process.env.APPWRITE_FUNCTION_API_ENDPOINT || process.env.VITE_APPWRITE_ENDPOINT || 'https://cloud.appwrite.io/v1')
        .setProject(process.env.APPWRITE_FUNCTION_PROJECT_ID || process.env.VITE_APPWRITE_PROJECT_ID)
        .setKey(process.env.APPWRITE_API_KEY);

    const databases = new Databases(client);
    const databaseId = process.env.VITE_APPWRITE_DATABASE_ID || process.env.APPWRITE_DATABASE_ID;
    const scansCollectionId = process.env.VITE_APPWRITE_SCANS_COLLECTION_ID || 'scans';
    const findingsCollectionId = process.env.VITE_APPWRITE_FINDINGS_COLLECTION_ID || 'findings';

    // 4. Create initial scan record
    log(`Creating scan record for ${repoUrl}...`);
    let scanDoc;
    try {
        scanDoc = await databases.createDocument(databaseId, scansCollectionId, ID.unique(), {
            repo_id: repoUrl,
            status: 'scanning',
            scan_type: 'repository',
            repoUrl,
            visibility,
            timestamp: new Date().toISOString(),
            scannerVersion: '0.69.3',
            criticalCount: 0,
            highCount: 0,
            mediumCount: 0,
            lowCount: 0
        });
    } catch (dbErr) {
        error(`Failed to create scan document: ${dbErr.message}`);
        return res.json({ success: false, error: 'Database error' }, 500);
    }

    // 5. Run Trivy
    log(`Running Trivy against ${repoUrl}...`);
    let output = '';
    try {
        output = execSync(`${TRIVY_PATH} repo --format json ${repoUrl}`, {
            encoding: 'utf-8',
            maxBuffer: 50 * 1024 * 1024
        });
    } catch (execErr) {
        output = execErr.stdout ? execErr.stdout.toString() : '';
        if (!output) {
            error(`Trivy execution failed: ${execErr.message}`);
            await databases.updateDocument(databaseId, scansCollectionId, scanDoc.$id, { status: 'failed' });
            return res.json({ success: false, error: 'Trivy execution failed: ' + execErr.message }, 500);
        }
        log('Trivy returned non-zero exit but produced JSON output — continuing.');
    }

    // 6. Parse Trivy output
    let report = {};
    try {
        report = JSON.parse(output);
    } catch (parseErr) {
        error(`Failed to parse Trivy output: ${parseErr.message}`);
        await databases.updateDocument(databaseId, scansCollectionId, scanDoc.$id, { status: 'failed' });
        return res.json({ success: false, error: 'Failed to parse Trivy output' }, 500);
    }

    // 7. Save findings
    let criticalCount = 0, highCount = 0, mediumCount = 0, lowCount = 0;
    const results = report.Results || [];
    log('Saving findings to database...');

    for (const result of results) {
        for (const vuln of (result.Vulnerabilities || [])) {
            const severity = (vuln.Severity || 'UNKNOWN').toUpperCase();
            if (severity === 'CRITICAL') criticalCount++;
            else if (severity === 'HIGH') highCount++;
            else if (severity === 'MEDIUM') mediumCount++;
            else if (severity === 'LOW') lowCount++;

            try {
                await databases.createDocument(databaseId, findingsCollectionId, ID.unique(), {
                    scanId: scanDoc.$id,
                    title: (vuln.Title || vuln.VulnerabilityID || 'Unknown').substring(0, 255),
                    severity: severity.substring(0, 50),
                    package: (vuln.PkgName || 'Unknown').substring(0, 255),
                    installedVersion: (vuln.InstalledVersion || 'Unknown').substring(0, 255),
                    fixedVersion: (vuln.FixedVersion || '').substring(0, 255),
                    description: (vuln.Description || '').substring(0, 4999)
                });
            } catch (vulnErr) {
                error(`Failed to save finding ${vuln.VulnerabilityID}: ${vulnErr.message}`);
            }
        }
    }

    // 8. Update scan with final counts
    log(`Scan complete — C:${criticalCount} H:${highCount} M:${mediumCount} L:${lowCount}`);
    try {
        await databases.updateDocument(databaseId, scansCollectionId, scanDoc.$id, {
            status: 'completed',
            criticalCount,
            highCount,
            mediumCount,
            lowCount
        });
    } catch (updateErr) {
        error(`Failed to update scan status: ${updateErr.message}`);
    }

    return res.json({
        success: true,
        scanId: scanDoc.$id,
        summary: { criticalCount, highCount, mediumCount, lowCount, total: criticalCount + highCount + mediumCount + lowCount }
    });
};
