import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';
import { query, updateScanStatus } from './db';

const execAsync = promisify(exec);

const TEMP_BASE_DIR = process.env.TEMP_DIR || '/tmp';

export interface ToolResult {
    tool: 'gitleaks' | 'trivy' | 'semgrep';
    findings: any[];
}

export const runScan = async (scanId: string, repoUrl: string) => {
    const repoPath = path.join(TEMP_BASE_DIR, scanId);

    try {
        // 1. Update status to scanning (Atomic)
        await updateScanStatus(scanId, 'scanning', 'scan_queued', { started_at: new Date() });

        // 2. Clone Repository
        console.log(`[Scanner] Cloning ${repoUrl} for scan ${scanId}`);
        await execAsync(`git clone --depth 1 "${repoUrl}" "${repoPath}"`, { timeout: 60000 });

        // 3. Run Tools
        const tools = [
            {
                name: 'gitleaks',
                image: 'zricethezav/gitleaks:latest',
                cmd: 'detect --source /repo --format json --report-path -'
            },
            {
                name: 'trivy',
                image: 'aquasec/trivy:latest',
                cmd: 'fs --format json /repo'
            },
            {
                name: 'semgrep',
                image: 'returntocorp/semgrep:latest',
                cmd: 'semgrep scan --json --config auto /repo'
            }
        ];

        const results: ToolResult[] = [];

        for (const tool of tools) {
            console.log(`[Scanner] Running ${tool.name} for scan ${scanId}`);
            try {
                const { stdout } = await execAsync(
                    `docker run --rm --network none --memory 512m --cpus="1.0" -v "${repoPath}":/repo:ro ${tool.image} ${tool.cmd}`,
                    { timeout: 300000 } // 5 minute timeout per tool
                );

                const findings = JSON.parse(stdout);
                results.push({ tool: tool.name as any, findings: Array.isArray(findings) ? findings : [findings] });
            } catch (error: any) {
                console.error(`[Scanner] Tool ${tool.name} failed for ${scanId}:`, error.message);
                // We continue if one tool fails, but log it
                if (error.stdout) {
                    try {
                        const findings = JSON.parse(error.stdout);
                        results.push({ tool: tool.name as any, findings: Array.isArray(findings) ? findings : [findings] });
                    } catch {
                        // Not JSON
                    }
                }
            }
        }

        // 4. Process Findings
        for (const result of results) {
            await saveFindings(scanId, result);
        }

        // 5. Finalize
        await updateScanStatus(scanId, 'completed', 'scanning', { completed_at: new Date() });
        console.log(`[Scanner] Scan ${scanId} completed successfully`);

    } catch (error: any) {
        console.error(`[Scanner] Scan ${scanId} failed:`, error.message);
        await updateScanStatus(scanId, 'failed', 'scanning', {
            error_message: error.message,
            completed_at: new Date()
        });
    } finally {
        // 6. Cleanup
        try {
            const exists = await fs.access(repoPath).then(() => true).catch(() => false);
            if (exists) {
                await fs.rm(repoPath, { recursive: true, force: true });
                console.log(`[Scanner] Successfully cleaned up ${repoPath}`);
            }
        } catch (e) {
            console.error(`[Scanner] Cleanup failed for ${scanId}:`, e);
        }
    }
};

async function saveFindings(scanId: string, result: ToolResult) {
    const { tool, findings } = result;

    for (const finding of findings) {
        let normalized: any = {};

        if (tool === 'gitleaks') {
            normalized = {
                scan_id: scanId,
                tool_source: 'gitleaks',
                severity: 'high', // Gitleaks doesn't specify severity, defaults to high for secrets
                title: finding.Description || 'Potential Secret Detected',
                description: `Secret found in ${finding.File}`,
                file_path: finding.File,
                line_number: finding.StartLine,
                cve_id: null,
                fix_version: null
            };
        } else if (tool === 'trivy') {
            // Trivy output is complex, this is simplified
            const vulnerabilities = (finding.Results || []).flatMap((r: any) => r.Vulnerabilities || []);
            for (const v of vulnerabilities) {
                await query(
                    'INSERT INTO vulnerabilities (scan_id, tool_source, severity, title, description, file_path, line_number, cve_id, fix_version) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
                    [scanId, 'trivy', v.Severity.toLowerCase(), v.Title || v.PkgName, v.Description, v.PkgName, null, v.VulnerabilityID, v.FixedVersion]
                );
            }
            return;
        } else if (tool === 'semgrep') {
            const results = finding.results || [];
            for (const r of results) {
                await query(
                    'INSERT INTO vulnerabilities (scan_id, tool_source, severity, title, description, file_path, line_number, cve_id, fix_version) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
                    [scanId, 'semgrep', mapSemgrepSeverity(r.extra.severity), r.check_id, r.extra.message, r.path, r.start.line, null, null]
                );
            }
            return;
        }

        if (normalized.title) {
            await query(
                'INSERT INTO vulnerabilities (scan_id, tool_source, severity, title, description, file_path, line_number, cve_id, fix_version) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
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
