import { Router, Response, Request } from 'express';
import { Models } from 'node-appwrite';
import { databases, DB_ID, Query, ID } from '../lib/appwrite';
import { verifyUser } from '../middleware/auth';
import { spawnSync } from 'child_process';
import { sendFindingAlert, FindingDocument } from '../utils/alertDispatcher';
import { scanTriggerLimiter } from '../middleware/rateLimiters';
import { logger } from '../services/logger';

interface AuthenticatedRequest extends Request {
    user?: Models.User<Models.Preferences>;
}

interface TrivyVulnerability {
    PkgName: string;
    InstalledVersion: string;
    FixedVersion?: string;
    VulnerabilityID: string;
    Severity?: string;
}

function errorMessage(err: unknown): string {
    return err instanceof Error ? err.message : 'Unknown error';
}

const router = Router();

// A conservative Docker image reference allowlist: must start with an alphanumeric
// character (so it can never be parsed as a CLI flag by trivy) and only contain
// characters legal in image names/tags/digests/registry hosts.
const IMAGE_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_.\-/:@]*$/;

router.post('/docker', verifyUser, scanTriggerLimiter, async (req: AuthenticatedRequest, res: Response) => {
    const { image_name } = req.body;
    if (!image_name) return res.status(400).json({ error: 'image_name is required' });
    if (typeof image_name !== 'string' || image_name.length > 255 || !IMAGE_NAME_PATTERN.test(image_name)) {
        return res.status(400).json({ error: 'Invalid image_name format' });
    }

    // Check if trivy is available
    const trivyCheck = spawnSync('trivy', ['--version']);
    if (trivyCheck.status !== 0) {
        return res.status(503).json({ error: "Trivy not available" });
    }

    try {
        logger.info(`[DockerScan] Scanning image: ${image_name}...`);
        const result = spawnSync('trivy', [
            'image',
            '--format', 'json',
            image_name
        ], { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });

        if (result.status !== 0) {
            return res.status(500).json({ error: "Trivy scan failed", details: result.stderr });
        }

        const output = JSON.parse(result.stdout || '{"Results": []}') as { Results?: { Vulnerabilities?: TrivyVulnerability[] }[] };
        const vulnerabilities = (output.Results || []).flatMap((r) => r.Vulnerabilities || []);

        const stats = {
            total: vulnerabilities.length,
            by_severity: { critical: 0, high: 0, medium: 0, low: 0 } as Record<string, number>,
            image_name
        };

        for (const vuln of vulnerabilities) {
            const severity = vuln.Severity?.toLowerCase() || 'low';
            if (stats.by_severity.hasOwnProperty(severity)) {
                stats.by_severity[severity]++;
            }

            const finding = {
                repo_id: 'docker',
                repo_name: image_name,
                type: 'docker',
                severity: severity,
                title: `${vuln.PkgName} (${vuln.InstalledVersion})`,
                description: `Fixed Version: ${vuln.FixedVersion || 'N/A'}`,
                cve_id: vuln.VulnerabilityID,
                file_path: image_name,
                status: 'open',
                created_at: new Date().toISOString(),
                scanId: ID.unique()
            };

            // Write to Appwrite
            const createdFinding = await databases.createDocument<FindingDocument>(
                DB_ID,
                'findings',
                ID.unique(),
                finding
            );

            // Alert Dispatcher
            const userId = req.user?.$id;
            if (userId) {
                await sendFindingAlert(createdFinding, userId);
            }
        }

        res.json(stats);

    } catch (err: unknown) {
        logger.error('[Docker API Error]', errorMessage(err));
        res.status(500).json({ error: 'Internal server error' });
    }
});

export default router;
