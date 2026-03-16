import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';
import { getClient, updateScanStatus } from './db';

const execAsync = promisify(exec);

const TEMP_BASE_DIR = process.env.TEMP_DIR || '/tmp';

export interface ToolResult {
    tool: 'gitleaks' | 'trivy' | 'semgrep';
    findings: any[];
}

export const runScan = async (scanId: string, repoUrl: string) => {
    const repoPath = path.join(TEMP_BASE_DIR, scanId);
    const client = await getClient();

    try {
        await client.query('BEGIN');

        // 1. Atomic Lock & State Transition
        const lockResult = await client.query(
            'SELECT status FROM scans WHERE id = $1 FOR UPDATE',
            [scanId]
        );

        if (lockResult.rows.length === 0 || lockResult.rows[0].status !== 'scan_queued') {
            console.log(`[Scanner] Scan ${scanId} already taken or not queued. Skipping.`);
            await client.query('ROLLBACK');
            return;
        }

        await updateScanStatus(scanId, 'scanning', 'scan_queued', { started_at: new Date() }, client);
        await client.query('COMMIT');

        // 2. Clone Repository with IO Hardening
        console.log(`[Scanner] Cloning ${repoUrl} for scan ${scanId}`);
        // --filter=blob:none for efficient shallow clone
        await execAsync(`git clone --depth 1 --filter=blob:none "${repoUrl}" "${repoPath}"`, { timeout: 60000 });

        // IO Guards
        const stats = await getDirStats(repoPath);
        if (stats.size > 500 * 1024 * 1024) throw new Error('Repo too large (>500MB)');
        if (stats.files > 100000) throw new Error('Too many files (>100k)');
        if (stats.depth > 20) throw new Error('Directory structure too deep (>20)');

        // 3. Pre-scan Cleanup (Zombies)
        await execAsync(`docker rm -f scanner-*-${scanId} || true`);

        // 4. Run Tools
        const tools = [
            {
                name: 'gitleaks',
                image: 'zricethezav/gitleaks:latest',
                cmd: 'detect --source /repo --report-format json --report-path -'
            },
            {
                name: 'trivy',
                image: 'aquasec/trivy:latest',
                cmd: 'fs --skip-db-update --format json /repo'
            },
            {
                name: 'semgrep',
                image: 'returntocorp/semgrep:latest',
                cmd: 'semgrep scan --json --timeout 300 --config /rules /repo'
            }
        ];

        const results: ToolResult[] = [];

        for (const tool of tools) {
            console.log(`[Scanner] Running ${tool.name} for scan ${scanId}`);
            const containerName = `scanner-${tool.name}-${scanId}`;
            try {
                let volumeMounts = `-v "${repoPath}":/repo:ro`;
                if (tool.name === 'trivy') {
                    volumeMounts += ` -v "/root/.cache/trivy":/root/.cache/trivy`;
                } else if (tool.name === 'semgrep') {
                    const semgrepRulesHostPath = process.env.SEMGREP_RULES_PATH || '/home/ubuntu/Stackpilot/engine/semgrep-rules';
                    volumeMounts += ` -v "${semgrepRulesHostPath}":/rules:ro`;
                }

                const { stdout } = await execAsync(
                    `docker run --rm --name ${containerName} --network none --memory 512m --cpus="1.0" --pids-limit 100 --read-only --tmpfs /tmp --tmpfs /root --cap-drop ALL --security-opt no-new-privileges ${volumeMounts} ${tool.image} ${tool.cmd}`,
                    { timeout: 300000 }
                );

                const findings = JSON.parse(stdout);
                results.push({ tool: tool.name as any, findings: Array.isArray(findings) ? findings : [findings] });
            } catch (error: any) {
                console.error(`[Scanner] Tool ${tool.name} failed for ${scanId}. Message: ${error.message}`);
                if (error.stderr) console.error(`[Scanner] Tool ${tool.name} stderr:`, error.stderr);

                await execAsync(`docker kill ${containerName} || true`);
                if (error.stdout) {
                    try {
                        const findings = JSON.parse(error.stdout);
                        results.push({ tool: tool.name as any, findings: Array.isArray(findings) ? findings : [findings] });
                    } catch { /* Not JSON */ }
                }
            } finally {
                await execAsync(`docker rm -f ${containerName} || true`);
            }
        }

        // 5. Atomic Save & Complete
        await client.query('BEGIN');
        await client.query('DELETE FROM vulnerabilities WHERE scan_id = $1', [scanId]);

        for (const result of results) {
            await saveFindingsInTx(scanId, result, client);
        }

        await updateScanStatus(scanId, 'completed', 'scanning', { completed_at: new Date() }, client);
        await client.query('COMMIT');
        console.log(`[Scanner] Scan ${scanId} completed successfully`);

    } catch (error: any) {
        console.error(`[Scanner] Scan ${scanId} failed:`, error.message);
        if (client) {
            try { await client.query('ROLLBACK'); } catch { /* Ignore */ }
        }
        await updateScanStatus(scanId, 'failed', 'scanning', {
            error_message: error.message,
            completed_at: new Date()
        });
    } finally {
        if (client) client.release();
        // 6. Cleanup Disk
        try {
            await fs.rm(repoPath, { recursive: true, force: true });
        } catch (e) { /* Ignore */ }
    }
};

async function getDirStats(dir: string, currentDepth = 0): Promise<{ size: number, files: number, depth: number }> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    let size = 0;
    let files = 0;
    let maxPathDepth = currentDepth;

    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            const sub = await getDirStats(fullPath, currentDepth + 1);
            size += sub.size;
            files += sub.files;
            maxPathDepth = Math.max(maxPathDepth, sub.depth);
        } else {
            const s = await fs.stat(fullPath);
            size += s.size;
            files++;
        }
    }
    return { size, files, depth: maxPathDepth };
}

async function saveFindingsInTx(scanId: string, result: ToolResult, client: any) {
    const { tool, findings } = result;

    for (const finding of findings) {
        let normalized: any = {};

        if (tool === 'gitleaks') {
            normalized = {
                scan_id: scanId,
                tool_source: 'gitleaks',
                severity: 'high',
                title: finding.Description || 'Potential Secret Detected',
                description: `Secret found in ${finding.File}`,
                file_path: finding.File,
                line_number: finding.StartLine,
                cve_id: null,
                fix_version: null
            };
        } else if (tool === 'trivy') {
            const vulnerabilities = (finding.Results || []).flatMap((r: any) => r.Vulnerabilities || []);
            for (const v of vulnerabilities) {
                await client.query(
                    'INSERT INTO vulnerabilities (scan_id, tool_source, severity, title, description, file_path, line_number, cve_id, fix_version) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT DO NOTHING',
                    [scanId, 'trivy', v.Severity.toLowerCase(), v.Title || v.PkgName, v.Description, v.PkgName, null, v.VulnerabilityID, v.FixedVersion]
                );
            }
            continue;
        } else if (tool === 'semgrep') {
            const semgrepResults = finding.results || [];
            for (const r of semgrepResults) {
                await client.query(
                    'INSERT INTO vulnerabilities (scan_id, tool_source, severity, title, description, file_path, line_number, cve_id, fix_version) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT DO NOTHING',
                    [scanId, 'semgrep', mapSemgrepSeverity(r.extra.severity), r.check_id, r.extra.message, r.path, r.start.line, null, null]
                );
            }
            continue;
        }

        if (normalized.title) {
            await client.query(
                'INSERT INTO vulnerabilities (scan_id, tool_source, severity, title, description, file_path, line_number, cve_id, fix_version) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT DO NOTHING',
                [normalized.scan_id, normalized.tool_source, normalized.severity, normalized.title, normalized.description, normalized.file_path, normalized.line_number, normalized.cve_id, normalized.fix_version]
            );
        }
    }
}

function mapSemgrepSeverity(sev: string): string {
    switch (sev.toUpperCase()) {
        case 'ERROR': return 'critical';
        case 'WARNING': return 'high';
        case 'INFO': return 'low';
        default: return 'medium';
    }
}
