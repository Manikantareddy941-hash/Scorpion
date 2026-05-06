import cron from 'node-cron';
import git from 'simple-git';
import { Client, Databases, ID, Query, Models } from 'node-appwrite';
import axios from 'axios';
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import cronParser from 'cron-parser';
import { sendFindingAlert } from '../utils/alertDispatcher';
import { logAuditEvent } from '../utils/auditLogger';

// Environment Variables
export let isWorkerRunning = false;
const APPWRITE_ENDPOINT = process.env.APPWRITE_ENDPOINT || 'https://sgp.cloud.appwrite.io/v1';
const APPWRITE_PROJECT_ID = process.env.APPWRITE_PROJECT_ID || '';
const APPWRITE_API_KEY = process.env.APPWRITE_API_KEY || '';
const APPWRITE_DATABASE_ID = process.env.APPWRITE_DATABASE_ID || '';

// Initialize Appwrite Client
const client = new Client()
    .setEndpoint(APPWRITE_ENDPOINT)
    .setProject(APPWRITE_PROJECT_ID)
    .setKey(APPWRITE_API_KEY);

const databases = new Databases(client);

interface Finding {
    repo_id: string;
    repo_name: string;
    type: string;
    severity: string;
    title: string;
    description: string;
    file_path: string;
    line_number?: number;
    cve_id?: string;
    created_at: string;
    status: string;
    scanId: string;
}

/**
 * Runs Gitleaks for secret detection
 */
function runGitleaks(repoPath: string, repo: any): Finding[] {
    console.log(`[Gitleaks] Scanning ${repo.name}...`);
    const reportId = ID.unique();
    const reportPath = path.join(os.tmpdir(), `gitleaks-${reportId}.json`);
    
    spawnSync('gitleaks', [
        'detect',
        '--source', repoPath,
        '--report-format', 'json',
        '--report-path', reportPath,
        '--exit-code', '0'
    ]);

    if (!fs.existsSync(reportPath)) {
        console.log(`[Gitleaks] No report generated for ${repo.name}.`);
        return [];
    }

    try {
        const reportContent = fs.readFileSync(reportPath, 'utf8');
        const leaks = JSON.parse(reportContent || '[]');
        fs.unlinkSync(reportPath); // Cleanup

        return leaks.map((leak: any) => ({
            repo_id: repo.$id,
            repo_name: repo.name,
            type: 'secret',
            severity: 'critical',
            title: `Secret Detected: ${leak.RuleID}`,
            description: `Potential secret found: ${leak.Description}`,
            file_path: leak.File,
            line_number: leak.StartLine,
            created_at: new Date().toISOString(),
            status: 'open',
            scanId: '' // Will be set in processRepo
        }));
    } catch (err) {
        console.error(`[Gitleaks Parse Error] ${repo.name}:`, err);
        return [];
    }
}

/**
 * Runs Dependency scan using OSV.dev API
 */
async function runDependencyScan(repoPath: string, repo: any): Promise<Finding[]> {
    console.log(`[DependencyScan] Scanning ${repo.name}...`);
    const findings: Finding[] = [];
    const packageJsonPath = path.join(repoPath, 'package.json');

    if (!fs.existsSync(packageJsonPath)) {
        return [];
    }

    try {
        const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
        const dependencies = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };

        for (const [name, version] of Object.entries(dependencies)) {
            const cleanVersion = (version as string).replace(/[\^~]/g, '');
            
            try {
                const response = await axios.post('https://api.osv.dev/v1/query', {
                    version: cleanVersion,
                    package: {
                        name: name,
                        ecosystem: 'npm'
                    }
                });

                if (response.data && response.data.vulns) {
                    for (const vuln of response.data.vulns) {
                        findings.push({
                            repo_id: repo.$id,
                            repo_name: repo.name,
                            type: 'dependency',
                            severity: 'high',
                            title: vuln.summary || `Vulnerability in ${name}`,
                            description: vuln.details || `Vulnerable version ${cleanVersion} detected for ${name}.`,
                            file_path: 'package.json',
                            cve_id: vuln.id,
                            created_at: new Date().toISOString(),
                            status: 'open',
                            scanId: '' // Will be set in processRepo
                        });
                    }
                }
            } catch (err: any) {
                console.error(`[OSV API Error] ${name}:`, err.message);
            }
        }
    } catch (err: any) {
        console.error(`[DependencyScan Error] ${repo.name}:`, err.message);
    }

    return findings;
}

/**
 * Runs SAST scan using Semgrep
 */
function runSastScan(repoPath: string, repo: any): Finding[] {
    console.log(`[SAST] Scanning ${repo.name} with Semgrep...`);
    const findings: Finding[] = [];

    try {
        const result = spawnSync('semgrep', [
            '--config=auto',
            repoPath,
            '--json',
            '--quiet'
        ], { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });

        if (result.status !== 0 && result.error) {
            console.warn(`[SAST Warning] Semgrep execution failed: ${result.error.message}`);
            return [];
        }

        const output = JSON.parse(result.stdout || '{"results": []}');
        const results = output.results || [];

        for (const res of results) {
            const severityMap: Record<string, string> = {
                'ERROR': 'critical',
                'WARNING': 'high',
                'INFO': 'medium'
            };

            findings.push({
                repo_id: repo.$id,
                repo_name: repo.name,
                type: 'sast',
                severity: severityMap[res.extra?.severity] || 'low',
                title: res.check_id || 'SAST Finding',
                description: res.extra?.message || 'Security issue detected by static analysis.',
                file_path: res.path,
                line_number: res.start?.line,
                cve_id: res.extra?.metadata?.cwe?.[0] || undefined,
                created_at: new Date().toISOString(),
                status: 'open',
                scanId: '' // Set in processRepo
            });
        }
    } catch (err: any) {
        console.error(`[SAST Error] ${repo.name}:`, err.message);
    }

    return findings;
}

/**
 * Runs IaC scan using Checkov
 */
function runIacScan(repoPath: string, repo: any): Finding[] {
    console.log(`[IaC] Scanning ${repo.name} with Checkov...`);
    const findings: Finding[] = [];

    try {
        const result = spawnSync('C:/Users/manik/AppData/Local/Programs/Python/Python313/Scripts/checkov.CMD', [
            '-d', repoPath,
            '--quiet',
            '--no-guide',
            '--soft-fail',
            '--output', 'json'
        ], { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024, shell: true });

        if (result.status !== 0 && result.error) {
            console.warn(`[IaC Warning] Checkov execution failed: ${result.error.message}`);
            return [];
        }

        const output = JSON.parse(result.stdout || '[]');
        // Checkov can return an object or an array of objects
        const scanResults = Array.isArray(output) ? output : [output];

        for (const scan of scanResults) {
            const failedChecks = scan.results?.failed_checks || [];
            for (const check of failedChecks) {
                findings.push({
                    repo_id: repo.$id,
                    repo_name: repo.name,
                    type: 'iac',
                    severity: check.severity?.toLowerCase() || 'medium',
                    title: `${check.check_id}: ${check.check_name}`,
                    description: `IaC policy violation detected in ${check.file_path}. Guide: ${check.guideline || 'N/A'}`,
                    file_path: check.file_path,
                    line_number: check.file_line_range?.[0],
                    created_at: new Date().toISOString(),
                    status: 'open',
                    scanId: ''
                });
            }
        }
    } catch (err: any) {
        console.error(`[IaC Error] ${repo.name}:`, err.message);
    }

    return findings;
}

/**
 * Main scan function
 */
export async function processRepo(repo: any) {
    const tempDir = path.join(os.tmpdir(), `scan-${repo.$id}-${Date.now()}`);
    const scanId = ID.unique();
    console.log(`[Worker] Starting scan for ${repo.name} at ${tempDir} (Scan ID: ${scanId})`);
    await logAuditEvent('SCAN_STARTED', `Autonomous scan initiated for ${repo.name}`, repo.user_id, repo.$id);

    try {
        await git().clone(repo.url, tempDir);
        
        const secretFindings = runGitleaks(tempDir, repo);
        const dependencyFindings = await runDependencyScan(tempDir, repo);
        const sastFindings = runSastScan(tempDir, repo);
        const iacFindings = runIacScan(tempDir, repo);
        
        const allFindings = [...secretFindings, ...dependencyFindings, ...sastFindings, ...iacFindings].map(f => ({
            ...f,
            scanId: scanId
        }));

        for (const finding of allFindings) {
            try {
                const createdFinding = await databases.createDocument(
                    APPWRITE_DATABASE_ID,
                    'findings',
                    ID.unique(),
                    finding
                );
                
                // Dispatch alert if necessary
                await sendFindingAlert(createdFinding as any, repo.user_id);
            } catch (err: any) {
                console.error(`[Appwrite Save Error]`, err.message);
            }
        }

        console.log(`[Worker] Scan completed for ${repo.name}. Found ${allFindings.length} issues.`);
        await logAuditEvent('SCAN_COMPLETED', `Scan completed. Found ${allFindings.length} security vectors.`, repo.user_id, repo.$id);

    } catch (err: any) {
        console.error(`[Worker Error] Failed to process ${repo.name}:`, err.message);
    } finally {
        if (fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    }
}

/**
 * Worker Main Loop
 */
export function initScanWorker() {
    isWorkerRunning = true;
    console.log('🛡️  [Scan Worker] Initializing Security Scan Worker...');

    // Startup check for tools
    try {
        const semgrepCheck = spawnSync('semgrep', ['--version']);
        if (semgrepCheck.status !== 0) {
            console.warn('⚠️  [Scan Worker] WARN: semgrep not found, SAST disabled');
        } else {
            console.log('✅ [Scan Worker] Semgrep detected and active');
        }

        const checkovCheck = spawnSync('C:/Users/manik/AppData/Local/Programs/Python/Python313/Scripts/checkov.CMD', ['--version'], { shell: true });
        if (checkovCheck.status !== 0) {
            console.warn('⚠️  [Scan Worker] WARN: checkov not found, IaC scanning disabled');
        } else {
            console.log('✅ [Scan Worker] Checkov detected and active');
        }
    } catch (err) {
        console.warn('⚠️  [Scan Worker] WARN: semgrep not found, SAST disabled');
    }

    cron.schedule('* * * * *', async () => {
        const now = new Date();
        
        try {
            const response = await databases.listDocuments(
                APPWRITE_DATABASE_ID,
                'repositories',
                [Query.equal('cron_enabled', true)]
            );

            for (const repo of response.documents) {
                const schedule = (repo as any).cron_schedule || '0 0 * * *';
                
                try {
                    const interval = cronParser.parseExpression(schedule);
                    const prevRun = interval.prev().toDate();
                    
                    const diffSeconds = (now.getTime() - prevRun.getTime()) / 1000;
                    if (diffSeconds >= 0 && diffSeconds < 60) {
                        console.log(`[Worker] Repo ${repo.name} is due for scan (Schedule: ${schedule})`);
                        processRepo(repo);
                    }
                } catch (err) {
                    console.error(`[Cron Parser Error] Invalid schedule for ${repo.name}: ${schedule}`);
                }
            }
        } catch (err: any) {
            console.error(`[Worker Error] Failed to fetch repositories:`, err.message);
        }
    });
}

export const triggerImmediateScan = processRepo;
