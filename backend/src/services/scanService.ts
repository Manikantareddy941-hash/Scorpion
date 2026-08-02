import { Models, Permission, Role } from 'node-appwrite';
import { databases, DB_ID, COLLECTIONS, ID, Query } from '../lib/appwrite';
import { notifyScanCompletion } from './notificationService';
import { assertScannersUsable, orchestrateScan, ScanOptions, ScanResult } from './scan/orchestrator';
import { normalizeSemgrep, normalizeTrivy, normalizeGitleaks, normalizeCheckov, normalizeBandit, normalizeHadolint } from '../scanners/normalizer';
import { evaluateQualityGate } from './qualityGateService';
import { deduplicateFindings } from '../deduplication';
import { evaluatePolicyResult } from './policyService';
import { respondToLeakedKeys, GitleaksRawMatch } from './leakedKeyResponseService';
import { vulnerabilitiesFound } from './metrics';
import { enrichIssues } from './enrichmentService';
import * as path from 'path';
import * as fs from 'fs';
import crypto from 'crypto';
import { logger } from './logger';
import { HadolintRawOutput, IngestableIssue, RepoWithScanStats, ScanRawResults, ScanTriggerOptions } from '../types/scan.types';

/**
 * Consistent security score formula — used here and must match Dashboard fallback.
 * Dashboard's final fallback (src/components/Dashboard.tsx) uses this exact
 * formula: 100 - (crit*10) - (high*4) - (med*1) - (low*0.25)
 */
const computeSecurityScore = (critical: number, high: number, medium: number, low: number): number => {
    const penalty = (critical * 10) + (high * 4) + (medium * 1) + (low * 0.25);
    return Math.max(0, Math.round(100 - penalty));
};

/**
 * Document-level read grants for a repo's scans and findings.
 *
 * A team-owned repo (team_id set) must grant read to the team, not just the
 * creating user — otherwise the vulnerabilities and scans collections, both
 * sealed with documentSecurity, hide a team repo's results from every member
 * except whoever triggered the scan. user_id is still granted so the owner sees
 * their own repos whether or not a team is involved.
 */
const ownerReadPerms = (repo: Models.DefaultDocument): string[] => {
    const perms: string[] = [];
    if (repo.user_id) perms.push(Permission.read(Role.user(String(repo.user_id))));
    if (repo.team_id) perms.push(Permission.read(Role.team(String(repo.team_id))));
    return perms;
};

/**
 * Counts active suppression entries in repo-local ignore files (.trivyignore,
 * .gitleaksignore) so silenced findings stay visible in the scan log instead
 * of just disappearing from the report. The files themselves are the audit
 * trail (version-controlled); this only surfaces that they're in effect.
 */
const countSuppressions = (scanPath: string): number => {
    const ignoreFiles = ['.trivyignore', '.gitleaksignore'];
    return ignoreFiles.reduce((total, name) => {
        try {
            const contents = fs.readFileSync(path.join(scanPath, name), 'utf-8');
            const activeLines = contents.split('\n').filter(l => l.trim() && !l.trim().startsWith('#'));
            return total + activeLines.length;
        } catch {
            return total; // file doesn't exist - no suppressions from this tool
        }
    }, 0);
};

/**
 * Attributes the `vulnerabilities` collection actually has.
 *
 * Appwrite rejects an entire createDocument call if the payload carries a key
 * the collection does not define, so anything not listed here must be dropped
 * rather than passed through. Spreading a scanner's own shape into the payload
 * is what broke ingestion: normalizeFindings emits `file`, `line`,
 * `reachability` and `fixAvailable`, none of which are columns, so every write
 * was rejected with "Unknown attribute" and no finding was stored between
 * 2026-05-14 and this fix.
 */
const STORED_FINDING_ATTRIBUTES = new Set([
    'repo_id', 'scan_result_id', 'tool', 'severity', 'message', 'file_path',
    'line_number', 'status', 'resolution_status', 'fingerprint', 'scanId',
    'package', 'version', 'fixVersion', 'pr_url', 'detected_at', 'cvss_score',
    'verified', 'type', 'endLine', 'code', 'effort', 'category', 'ruleId',
    'runId', 'source', 'title', 'reopenCount', 'resolvedAt', 'epss_score',
    'epss_percentile', 'kev', 'risk_score',
]);

/**
 * Column name for each of the shapes that reach this function.
 *
 * The normalizer (scanners/normalizer.ts) uses `file`/`line`; IngestableIssue
 * uses `filePath`/`cveId`; the collection uses `file_path`/`line_number`/
 * `cve_id`. Three vocabularies for the same three values.
 */
const FINDING_FIELD_ALIASES: Record<string, string> = {
    file: 'file_path',
    filePath: 'file_path',
    line: 'line_number',
    lineNumber: 'line_number',
    cveId: 'cve_id',
    scanResultId: 'scan_result_id',
    // deduplication.ts renames tool -> scanner on its way through.
    scanner: 'tool',
};

/**
 * Translates a scanner finding into the collection's own vocabulary and drops
 * anything it has no column for. `reachability` and `fixAvailable` are dropped
 * deliberately: gateService reads them from the in-memory finding before
 * storage, never back out of the database.
 */
export function toStoredFinding(
    issue: object,
    repoId: string,
    scanId: string,
): Record<string, unknown> {
    const stored: Record<string, unknown> = {
        repo_id: repoId,
        scanId,
        detected_at: new Date().toISOString(),
        status: 'open',
    };

    for (const [key, value] of Object.entries(issue)) {
        if (value === undefined) continue;
        const column = FINDING_FIELD_ALIASES[key] ?? key;
        if (!STORED_FINDING_ATTRIBUTES.has(column)) continue;
        stored[column] = value;
    }

    // Appwrite's `code` column is capped; oversize input fails the whole write.
    stored.code = String((issue as { code?: unknown }).code ?? '').slice(0, 4999);
    return stored;
}

export const ingestVulnerabilitiesDelta = async (
    repoId: string,
    scanId: string,
    issues: IngestableIssue[],
    // When set, reconciliation only resolves open findings whose `tool` is in
    // this list. The DAST workers (ZAP/Nuclei/ffuf) all ingest under the same
    // repo_id ('dast'), so without a scope each scanner's delta would resolve
    // the previous scanner's findings and silently pass a gate that should
    // block. Omitted for triggerScan (single combined multi-tool batch), which
    // keeps the original resolve-everything behaviour.
    // ponytail: scopes by tool, not by tenant — one user's 'dast' scan still
    // reconciles another user's same-tool 'dast' findings. Fix the shared
    // global 'dast' repo_id (per-user/per-target id) if DAST goes multi-tenant.
    toolScope?: string[],
    // Document-level permissions stamped on every created finding. The
    // vulnerabilities collection is sealed (documentSecurity=true, no
    // collection grants), so a finding created without these is invisible to
    // every browser session — /api/issues still works via the server key, but
    // realtime never delivers and direct reads return nothing.
    ownerDocPerms: string[] = []
): Promise<{ uniqueIncoming: IngestableIssue[] }> => {
    try {
        logger.info(`[Delta Ingestion] Starting delta ingestion for repo: ${repoId}, scan: ${scanId}`);

        // Helper to compute a consistent SHA-256 fingerprint for a vulnerability
        const computeHash = (rId: string, fPath: string | undefined, cveOrTitle: string | undefined, sev: string | undefined): string => {
            const data = `${rId}|${fPath || ''}|${cveOrTitle || ''}|${(sev || '').toUpperCase()}`;
            return crypto.createHash('sha256').update(data).digest('hex');
        };

        // 1. Fetch active (open) vulnerabilities currently stored in Appwrite for this repo
        const activeDocsResponse = await databases.listDocuments(DB_ID, COLLECTIONS.VULNERABILITIES, [
            Query.equal('repo_id', repoId),
            Query.equal('status', 'open'),
            Query.limit(500)
        ]);
        const activeDocs = activeDocsResponse.documents || [];

        // 2. Map existing documents to their computed hashes
        const activeHashMap = new Map<string, Models.Document>();
        activeDocs.forEach(doc => {
            const hash = computeHash(
                doc.repo_id, 
                doc.filePath || doc.file_path, 
                doc.cveId || doc.title, 
                doc.severity
            );
            activeHashMap.set(hash, doc);
        });

        // 3. Compute hashes for incoming issues
        const incomingHashMap = new Map<string, IngestableIssue>();
        issues.forEach(issue => {
            const hash = computeHash(
                repoId, 
                issue.filePath || issue.file_path, 
                issue.cveId || issue.title, 
                issue.severity
            );
            incomingHashMap.set(hash, issue);
        });

        // 4. Calculate deltas
        const newOrModifiedIssues: IngestableIssue[] = [];
        const resolvedDocs: Models.Document[] = [];

        // Find new/modified (in incoming, but not in existing Appwrite)
        for (const [hash, issue] of incomingHashMap.entries()) {
            if (!activeHashMap.has(hash)) {
                newOrModifiedIssues.push(issue);
            }
        }

        // Find resolved (in existing Appwrite, but missing from incoming)
        for (const [hash, doc] of activeHashMap.entries()) {
            if (!incomingHashMap.has(hash)) {
                // Only reconcile within the ingesting tool's scope so sibling
                // scanners sharing this repo_id aren't wrongly marked resolved.
                if (toolScope && !toolScope.includes((doc as { tool?: string }).tool ?? '')) continue;
                resolvedDocs.push(doc);
            }
        }

        logger.info(`[Delta Ingestion] Ingestion results for ${repoId}:` + 
            ` Total Incoming: ${issues.length},` +
            ` Active in DB: ${activeDocs.length},` +
            ` New/Modified to Create: ${newOrModifiedIssues.length},` +
            ` Resolved to Update: ${resolvedDocs.length}`
        );

        // 4b. Threat-intel enrichment (EPSS + CISA KEV) on the new findings
        // only. Best-effort: a feed outage degrades to severity-only scoring.
        let issuesToInsert: IngestableIssue[] = newOrModifiedIssues;
        try {
            issuesToInsert = await enrichIssues(newOrModifiedIssues);
        } catch (enrichErr) {
            logger.warn('[Delta Ingestion] Enrichment failed, ingesting unenriched findings:', enrichErr instanceof Error ? enrichErr.message : enrichErr);
        }

        // 5. Batch writes using parallel execution (using Promise.all on chunks to limit concurrent connections)
        const CHUNK_SIZE = 15;

        // A. Insert New/Modified findings
        for (let i = 0; i < issuesToInsert.length; i += CHUNK_SIZE) {
            const chunk = issuesToInsert.slice(i, i + CHUNK_SIZE);
            await Promise.all(chunk.map(async (issue) => {
                const payload = toStoredFinding(issue, repoId, scanId);
                try {
                    await databases.createDocument(DB_ID, COLLECTIONS.VULNERABILITIES, ID.unique(), payload, ownerDocPerms);
                } catch (saveErr) {
                    // A collection that predates the enrichment migration rejects
                    // the new attributes - retry once without them rather than
                    // dropping the finding.
                    const stripped = { ...payload } as Record<string, unknown>;
                    delete stripped.epss_score;
                    delete stripped.epss_percentile;
                    delete stripped.kev;
                    delete stripped.risk_score;
                    try {
                        await databases.createDocument(DB_ID, COLLECTIONS.VULNERABILITIES, ID.unique(), stripped, ownerDocPerms);
                        logger.warn('[Delta Ingestion] Stored finding without enrichment fields - run migrate_enrichment.ts to add them to the collection.');
                    } catch (retryErr) {
                        // Interpolated, not passed as a second argument: the
                        // logger drops extra args, so this line printed a bare
                        // "Failed to create vulnerability document:" with the
                        // reason discarded. Ingestion was broken for two months
                        // and the log said nothing about why.
                        const first = saveErr instanceof Error ? saveErr.message : String(saveErr);
                        const second = retryErr instanceof Error ? retryErr.message : String(retryErr);
                        logger.error(
                            `[Delta Ingestion] Failed to create vulnerability document. ` +
                            `first attempt: ${first} | retry without enrichment fields: ${second}`,
                        );
                    }
                }
            }));
        }

        // B. Mark missing vulnerabilities as Resolved
        for (let i = 0; i < resolvedDocs.length; i += CHUNK_SIZE) {
            const chunk = resolvedDocs.slice(i, i + CHUNK_SIZE);
            await Promise.all(chunk.map(async (doc) => {
                try {
                    await databases.updateDocument(DB_ID, COLLECTIONS.VULNERABILITIES, doc.$id, {
                        status: 'resolved',
                        resolvedAt: new Date().toISOString()
                    });
                    logger.info(`[Delta Ingestion] Marked vulnerability ${doc.$id} as RESOLVED.`);
                } catch (updateErr) {
                    logger.error(`[Delta Ingestion] Failed to update resolved document status:`, updateErr instanceof Error ? updateErr.message : updateErr);
                }
            }));
        }

        // The hash-dedup above collapses same file+cve+severity duplicates, so
        // this — not the raw incoming batch — is what actually represents the
        // repository's current findings. Callers count severities from it;
        // counting the raw batch made the scan record disagree with the stored
        // findings (228 vs 171 on the first verified run).
        return { uniqueIncoming: [...incomingHashMap.values()] };
    } catch (err) {
        logger.error(`[Delta Ingestion Error] Failed to compute or ingest scan deltas:`, err instanceof Error ? err.message : err);
        
        // Fallback: if delta logic fails, fallback to standard insertion so telemetry is never lost
        logger.info(`[Delta Ingestion] Falling back to standard bulk creation...`);
        for (const issue of issues) {
            try {
                // Through the same field mapping as the main path. This used to
                // spread the raw issue, which is the exact unknown-attribute
                // rejection the main path fixed - a fallback that fails the
                // same way is not a fallback.
                await databases.createDocument(
                    DB_ID, COLLECTIONS.VULNERABILITIES, ID.unique(),
                    toStoredFinding(issue, repoId, scanId), ownerDocPerms,
                );
            } catch (fallbackErr) {
                logger.error(`[Delta Ingestion Fallback] Save failed:`, fallbackErr instanceof Error ? fallbackErr.message : fallbackErr);
            }
        }
        return { uniqueIncoming: issues };
    }
};

const addScanLog = async (scanId: string, log: string) => {
    try {
        const scan = await databases.getDocument(DB_ID, COLLECTIONS.SCANS, scanId);
        const currentLogs = Array.isArray(scan.logs) ? scan.logs : [];
        await databases.updateDocument(DB_ID, COLLECTIONS.SCANS, scanId, {
            logs: [...currentLogs, `[${new Date().toLocaleTimeString()}] ${log}`]
        });
    } catch (err) {
        logger.error('[ScanService] Failed to add log:', err);
    }
};

export const triggerScan = async (
    repoId: string,
    options: ScanTriggerOptions = {},
    existingScanId?: string   // ← ADD THIS PARAMETER
): Promise<{ scanId: string | null; error: string | null }> => {
    let scanId: string | null = existingScanId || null;
    const scanStartedAt = new Date().toISOString();
    
    try {
        // 1️⃣ Validate repo
        if (!COLLECTIONS.REPOSITORIES) throw new Error("collectionId is undefined");
        const repo = await databases.getDocument(DB_ID, COLLECTIONS.REPOSITORIES, repoId);

        if (!repo)       return { scanId: null, error: 'Repository not found' };
        if (!repo.url)   return { scanId: null, error: 'Repository URL missing' };

        // 2️⃣ Determine target
        let targetPath = repo.url;
        if (repo.url.startsWith('upload://')) {
            targetPath = repo.local_path;
            if (!targetPath) return { scanId: null, error: 'Local path missing' };
        }

        // 3️⃣ Create scan record ONLY if not already created by the route
        if (!scanId) {
            // (duplicate scan check only needed when scanId not pre-created)
            const activeScans = await databases.listDocuments(DB_ID, COLLECTIONS.SCANS, [
                Query.equal('repo_id', repoId),
                Query.equal('status', ['pending', 'running']),
                Query.limit(1)
            ]);
            if (activeScans.total > 0) {
                return { scanId: null, error: 'A scan is already in progress for this repository' };
            }

            // Stamp document-level read for the repo owner (and team, if any) so
            // their browser session receives realtime updates (documentSecurity:
            // true on scans means realtime only delivers to sessions that can
            // read the document).
            const ownerDocPerms = ownerReadPerms(repo);
            const scan = await databases.createDocument(DB_ID, COLLECTIONS.SCANS, ID.unique(), {
                repo_id: repoId,
                status: 'pending',
                scan_type: options.scanType || 'full',
                repoUrl: repo.url,
                startedAt: scanStartedAt,
                timestamp: scanStartedAt,
                scannerVersion: '1.0.0',
                visibility: 'public',
                criticalCount: 0,
                highCount: 0,
                mediumCount: 0,
                lowCount: 0,
                details: JSON.stringify({
                    started_at: scanStartedAt,
                    target: targetPath,
                    branch: options.branch || 'main',
                    depth: options.scanDepth || 'standard'
                })
            }, ownerDocPerms);
            scanId = scan.$id;
        }

        // 4️⃣ Update to running
        await databases.updateDocument(DB_ID, COLLECTIONS.SCANS, scanId!, { status: 'running' });

        // Update repo cooldown immediately
        await databases.updateDocument(DB_ID, COLLECTIONS.REPOSITORIES, repoId, {
            last_scan_at: new Date().toISOString()
        });

        // 5️⃣ Clone if remote
        let scanPath = targetPath;
        let isTemporary = false;

        if (targetPath.startsWith('http')) {
            logger.info('[ScanService] Cloning remote repo:', targetPath, 'Branch:', options.branch || 'main');
            const tempDir = path.join(process.cwd(), 'tmp', `repo_${scanId}`);
            if (!fs.existsSync(path.join(process.cwd(), 'tmp'))) {
                fs.mkdirSync(path.join(process.cwd(), 'tmp'), { recursive: true });
            }
            try {
                const { spawn } = await import('child_process');
                const branchArgs = options.branch ? ['--branch', options.branch] : [];
                const cloneArgs = ['clone', '--depth', '1', ...branchArgs, targetPath, tempDir];
                
                await new Promise((resolve, reject) => {
                    const child = spawn('git', cloneArgs, { timeout: 60000 });
                    child.on('error', reject);
                    child.on('close', (code) => {
                        if (code === 0) resolve(true);
                        else reject(new Error(`Git clone exited with code ${code}`));
                    });
                });
                scanPath = tempDir;
                isTemporary = true;
            } catch (cloneErr) {
                logger.error('[ScanService] Clone failed:', cloneErr);
                throw new Error(`Failed to clone repository: ${cloneErr instanceof Error ? cloneErr.message : cloneErr}`);
            }
        }

        // 6️⃣ Run scans
        await addScanLog(scanId!, "Initiating multi-engine security audit...");
        const timeoutPromise = new Promise<ScanResult[]>((_, reject) =>
            setTimeout(() => reject(new Error('Scan Orchestrator Timeout (5m)')), 5 * 60 * 1000)
        );
        const rawResults = await Promise.race([
            // options is intentionally wider than orchestrator's own ScanOptions (see
            // scan.types.ts) since callers use different scanType vocabularies; this is
            // the one place it crosses into the orchestrator's stricter contract.
            orchestrateScan(scanPath, options as ScanOptions, (log) => addScanLog(scanId!, log)),
            timeoutPromise
        ]);
        await addScanLog(scanId!, "All security engines finalized.");

        // Abort before anything downstream can mistake a scanner that never ran
        // for a clean one. Unlike the CI pipeline this normalizes all six tools
        // into the stored finding set and the quality gate, so every scanner
        // that reported must have produced a verdict — no subset is passed.
        //
        // The catch at the end of this function marks the scan `failed` with
        // `gate_status: 'failed'`, which is the fail-closed outcome.
        assertScannersUsable(rawResults);

        // 7️⃣ Walk repo for file/line stats
        const languageCounts: Record<string, number> = {};
        const extensionMap: Record<string, string> = {
            '.java': 'Java', '.ts': 'TypeScript', '.tsx': 'TypeScript',
            '.js': 'JavaScript', '.py': 'Python', '.go': 'Go',
            '.cpp': 'C++', '.cs': 'C#'
        };
        let totalLines = 0;
        let totalFiles = 0;

        const walkSync = (dir: string) => {
            try {
                const files = fs.readdirSync(dir);
                files.forEach(file => {
                    const fullPath = path.join(dir, file);
                    try {
                        if (fs.statSync(fullPath).isDirectory()) {
                            if (file !== '.git' && file !== 'node_modules') walkSync(fullPath);
                        } else {
                            totalFiles++;
                            const ext = path.extname(file).toLowerCase();
                            try {
                                const content = fs.readFileSync(fullPath, 'utf-8');
                                totalLines += content.split('\n').length;
                            } catch {}
                            if (extensionMap[ext]) {
                                const lang = extensionMap[ext];
                                languageCounts[lang] = (languageCounts[lang] || 0) + 1;
                            }
                        }
                    } catch {}
                });
            } catch {}
        };
        walkSync(scanPath);
        const detectedLanguage = Object.entries(languageCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'Unknown';

        logger.info(`[STRICT DEBUG] Raw Scan Output Lengths: Semgrep: ${rawResults.find(r => r.tool === 'semgrep')?.stdout.length || 0}, Gitleaks: ${rawResults.find(r => r.tool === 'gitleaks')?.stdout.length || 0}, Trivy: ${rawResults.find(r => r.tool === 'trivy')?.stdout.length || 0}, Checkov: ${rawResults.find(r => r.tool === 'checkov')?.stdout.length || 0}, Bandit: ${rawResults.find(r => r.tool === 'bandit')?.stdout.length || 0}, Hadolint: ${rawResults.find(r => r.tool === 'hadolint')?.stdout.length || 0}`);

        const suppressedCount = countSuppressions(scanPath);
        if (suppressedCount > 0) {
            logger.info(`[Scan] ${suppressedCount} finding(s) suppressed via .trivyignore/.gitleaksignore for repo ${repoId}`);
        }

        // 8️⃣ Parse findings (Normalized)
        const scanResults: ScanRawResults = {};
        rawResults.forEach(r => {
            try {
                scanResults[r.tool] = JSON.parse(r.stdout);
            } catch (e) {
                scanResults[r.tool] = r.tool === 'gitleaks' ? [] : {};
            }
        });

        // Check raw (pre-redaction) Gitleaks matches against the repo owner's
        // API keys and auto-revoke any that were leaked, before the Match
        // field gets redacted by normalizeGitleaks below for storage.
        // Raw scanner JSON shapes are genuinely dynamic third-party output - cast
        // at this boundary rather than typing scanResults' fields beyond "unknown".
        const rawGitleaks = (scanResults.gitleaks ?? []) as GitleaksRawMatch[];
        await respondToLeakedKeys(rawGitleaks, repo.user_id, repoId);

        const issues = [
            ...normalizeTrivy(scanResults.trivy ?? {}, scanPath),
            ...normalizeSemgrep(scanResults.semgrep ?? {}, scanPath),
            ...normalizeGitleaks(rawGitleaks, scanPath),
            ...normalizeCheckov(scanResults.checkov ?? {}, scanPath),
            ...normalizeBandit(scanResults.bandit ?? {}, scanPath),
            ...normalizeHadolint((scanResults.hadolint ?? []) as HadolintRawOutput, scanPath)
        ];

// Deduplicate overlapping findings across scanners
const dedupedIssues = deduplicateFindings(issues);

        dedupedIssues.forEach(i => vulnerabilitiesFound.inc({ severity: i.severity, tool: i.scanner }));

        // Store first. The per-document read grant mirrors the scan document
        // above - the collection is sealed, so a finding without one is
        // invisible to the owner's browser and realtime never delivers it.
        const findingDocPerms = ownerReadPerms(repo);
        const { uniqueIncoming } = await ingestVulnerabilitiesDelta(
            repoId, scanId!, dedupedIssues, undefined, findingDocPerms,
        );

        // Count by severity from what ingestion actually kept. The delta
        // collapses same file+cve+severity duplicates, so counting the raw
        // deduped batch overstated the scan record against the stored findings
        // (228 vs 171 on the first verified run) - the dashboard tiles would
        // disagree with the issues list.
        const criticalCount = uniqueIncoming.filter(i => i.severity === 'CRITICAL').length;
        const highCount     = uniqueIncoming.filter(i => i.severity === 'HIGH').length;
        const mediumCount   = uniqueIncoming.filter(i => i.severity === 'MEDIUM').length;
        const lowCount      = uniqueIncoming.filter(i => i.severity === 'LOW').length;
        const infoCount     = uniqueIncoming.filter(i => i.severity === 'INFO').length;
        const totalVulns    = uniqueIncoming.length;

        // Semantic Mappings for Dashboard
        const banditCount = dedupedIssues.filter(i => i.scanner === 'bandit').length;
        const codeSmellCount = dedupedIssues.filter(i => i.scanner === 'semgrep' && (i.severity === 'INFO' || i.severity === 'LOW')).length;

        // FIX: single consistent score formula matching Dashboard fallback
        const score    = computeSecurityScore(criticalCount, highCount, mediumCount, lowCount);
        const riskScore = 100 - score;

        logger.info(JSON.stringify({ scanId, repoId, stage: 'save', status: 'success', saved_count: totalVulns }));

        // 1️⃣1️⃣ Evaluate policy gate against the counts just computed. Passing
        // them in avoids re-reading the scan document, which is still 'running'
        // with unwritten details at this point — evaluateScan would throw.
        let gateStatus: 'passed' | 'failed' = score >= 50 ? 'passed' : 'failed';
        try {
            const policyResult = await evaluatePolicyResult(scanId!, repoId, {
                critical: criticalCount,
                high: highCount,
                securityScore: score,
            });
            if (policyResult?.result) {
                gateStatus = (policyResult.result === 'PASS' || policyResult.result === 'WARN') ? 'passed' : 'failed';
            }
        } catch (policyErr) {
            logger.error('[ScanService] Policy evaluation error:', policyErr);
        }

        // 1️⃣2️⃣ Finalize scan record
        const completedAt = new Date().toISOString();
        const scanCompletePayload = {
            status: 'completed',
            completedAt,
            criticalCount,
            highCount,
            mediumCount,
            lowCount,
            details: JSON.stringify({
                completed_at: completedAt,
                started_at: scanStartedAt,
                critical_count: criticalCount,
                high_count: highCount,
                medium_count: mediumCount,
                low_count: lowCount,
                info_count: infoCount,
                total_vulnerabilities: totalVulns,
                bugs: banditCount,
                code_smells: codeSmellCount,
                security_score: score,
                gate_status: gateStatus,
                language: detectedLanguage,
                tools: ['semgrep', 'gitleaks', 'trivy', 'checkov', 'bandit'],
                total_files: totalFiles,
                total_lines: totalLines,
                tool_counts: {
                    semgrep:  dedupedIssues.filter(i => i.scanner === 'semgrep').length,
                    gitleaks: dedupedIssues.filter(i => i.scanner === 'gitleaks').length,
                    trivy:    dedupedIssues.filter(i => i.scanner === 'trivy').length,
                    checkov:  dedupedIssues.filter(i => i.scanner === 'checkov').length,
                    bandit:   dedupedIssues.filter(i => i.scanner === 'bandit').length,
                }
            })
        };

        await databases.updateDocument(DB_ID, COLLECTIONS.SCANS, scanId!, scanCompletePayload);

        // 🔟 Evaluate Quality Gate (A/B/C/D/F)
        const gateResult = await evaluateQualityGate(scanId!);

        // Update repo document with security_score for dashboard fallbacks
        await databases.updateDocument(DB_ID, COLLECTIONS.REPOSITORIES, repoId, {
            last_scan_at: completedAt,
            vulnerability_count: totalVulns,
            risk_score: riskScore,
            security_score: score,
            updated_at: completedAt
        });

        // 🧹 Cleanup
        if (isTemporary && fs.existsSync(scanPath)) {
            fs.rmSync(scanPath, { recursive: true, force: true });
        }

        await notifyScanCompletion(scanId!);
        return { scanId, error: null };

    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error(JSON.stringify({ scanId, repoId, stage: 'fail', error: message }));
        if (scanId) {
            try {
                await databases.updateDocument(DB_ID, COLLECTIONS.SCANS, scanId, {
                    status: 'failed',
                    completedAt: new Date().toISOString(),
                    details: JSON.stringify({
                        error: message,
                        security_score: 0,
                        gate_status: 'failed',
                        critical_count: 0,
                        high_count: 0,
                        medium_count: 0,
                        low_count: 0,
                        total_vulnerabilities: 0,
                        total_lines: 0
                    })
                });
            } catch { /* best-effort status update */ }
        }
        return { scanId, error: message || 'Failed to complete scan' };
    }
};

export const getInsightsSummary = async (userId: string) => {
    try {
        if (!COLLECTIONS.REPOSITORIES) throw new Error("collectionId is undefined");
        const reposDocs = await databases.listDocuments(DB_ID, COLLECTIONS.REPOSITORIES, [
            Query.equal('user_id', userId),
            Query.orderDesc('last_scan_at')
        ]);
        const repos = reposDocs.documents;
        if (repos.length === 0) return { repos: [], scans: [], overallScore: 0, totalVulns: 0 };

        const repoIds = repos.map(r => r.$id);
        if (!COLLECTIONS.SCANS) throw new Error("collectionId is undefined");
        const scansDocs = await databases.listDocuments(DB_ID, COLLECTIONS.SCANS, [
            Query.equal('repo_id', repoIds),
            Query.equal('status', 'completed'),
            Query.orderDesc('startedAt'),
            Query.limit(10)
        ]);
        const scans = scansDocs.documents.map(s => ({
            ...s,
            details: typeof s.details === 'string' ? JSON.parse(s.details) : s.details
        }));
        const totalVulns = (repos as RepoWithScanStats[]).reduce((acc, r) => acc + (r.vulnerability_count || 0), 0);
        const overallScore = scans.length > 0 ? (scans[0].details?.security_score || 0) : 0;
        return { repos, scans, overallScore, totalVulns };
    } catch (err) {
        logger.error('[ScanService] Error getting insights summary:', err);
        return { repos: [], scans: [], overallScore: 0, totalVulns: 0 };
    }
};