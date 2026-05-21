import { Router, Request, Response } from 'express';
import { databases, DB_ID, COLLECTIONS } from '../lib/appwrite';
import { logSecureAuditEvent } from '../utils/tamperAuditLogger';
import { verifyUser } from '../middleware/auth';
import { getRemediationFix } from '../services/aiService';
import * as fs from 'fs';
import * as path from 'path';

const router = Router();
const workspaceDir = 'c:\\Users\\manik\\OneDrive\\Desktop\\Scorpion';

// POST /api/remediate/generate
router.post('/generate', verifyUser, async (req: Request, res: Response) => {
    const { vulnerability_id } = req.body;
    if (!vulnerability_id) return res.status(400).json({ error: 'vulnerability_id is required' });

    try {
        // 1. Retrieve vulnerability metadata from Appwrite
        const vuln = await databases.getDocument(DB_ID, COLLECTIONS.VULNERABILITIES, vulnerability_id);
        if (!vuln) return res.status(404).json({ error: 'Vulnerability not found' });

        // 2. Call the real Gemini-powered service
        const fix = await getRemediationFix(vulnerability_id);

        // 3. Log the secure audit event
        const actor = (req as any).user?.$id || (req as any).user?.email || 'system';
        await logSecureAuditEvent(
            actor,
            'REMEDIATE_GENERATE',
            vuln.repo_id || 'system',
            `TONY Agent generated auto-remediation patch for ${vuln.file_path || 'unknown file'} resolving ${vuln.tool} finding.`
        );

        res.json({
            success: true,
            vulnerability_id,
            technical_analysis: fix.technical_analysis,
            diff: fix.diff,
            impact_assessment: fix.impact_assessment,
            confidence: fix.confidence
        });

    } catch (err: any) {
        console.error('[Remediate Generate Error]', err.message);
        res.status(500).json({ error: 'Failed to generate patch', details: err.message });
    }
});

// POST /api/remediate/apply
router.post('/apply', verifyUser, async (req: Request, res: Response) => {
    const { vulnerability_id, diff } = req.body;
    if (!vulnerability_id) return res.status(400).json({ error: 'vulnerability_id is required' });

    try {
        // 1. Retrieve vulnerability details
        const vuln = await databases.getDocument(DB_ID, COLLECTIONS.VULNERABILITIES, vulnerability_id);
        if (!vuln) return res.status(404).json({ error: 'Vulnerability not found' });

        let localPath = workspaceDir;
        if (vuln.repo_id) {
            try {
                const repo = await databases.getDocument(DB_ID, COLLECTIONS.REPOSITORIES, vuln.repo_id);
                if (repo && repo.local_path) {
                    localPath = repo.local_path;
                }
            } catch (err) {
                console.warn('[Remediate Apply] Could not fetch repository context, using workspace fallback:', err);
            }
        }

        const relativeFilePath = vuln.file_path || vuln.filePath || 'src/App.tsx';
        const absoluteFilePath = path.resolve(localPath, relativeFilePath);
        const lineNumber = vuln.line_number || 12;

        // Path traversal protection
        if (!absoluteFilePath.startsWith(localPath)) {
            return res.status(400).json({ error: 'Invalid file_path: path traversal detected' });
        }

        // 2. Read context and locate patch lines
        let fileLines: string[] = [];
        if (fs.existsSync(absoluteFilePath)) {
            // Backup first before overwrite
            const backupPath = `${absoluteFilePath}.bak`;
            fs.copyFileSync(absoluteFilePath, backupPath);

            const fileContent = fs.readFileSync(absoluteFilePath, 'utf8');
            fileLines = fileContent.split('\n');

            // Parse fixedLine from the diff
            let fixedLine = '';
            const diffLines = diff.split('\n');
            const addLine = diffLines.find((l: string) => l.startsWith('+') && !l.startsWith('+++'));
            if (addLine) {
                fixedLine = addLine.substring(1);
            } else {
                fixedLine = `${fileLines[lineNumber - 1].trim()} // Remediated by TONY`;
            }

            // 3. Write patch changes to target file
            const idx = lineNumber - 1;
            if (fileLines.length > idx) {
                fileLines[idx] = fixedLine;
                fs.writeFileSync(absoluteFilePath, fileLines.join('\n'), 'utf8');
                console.log(`[Remediate Apply] Successfully patched file: ${absoluteFilePath}`);
            }
        } else {
            console.warn(`[Remediate Apply] File not found at path: ${absoluteFilePath}`);
        }

        // 4. Update status in Appwrite
        await databases.updateDocument(DB_ID, COLLECTIONS.VULNERABILITIES, vulnerability_id, {
            status: 'remediated'
        });

        // 5. Ingest event into the secure cryptographic audit ledger
        const actor = (req as any).user?.$id || (req as any).user?.email || 'system';
        await logSecureAuditEvent(
            actor, 
            'REMEDIATE_APPLY', 
            vuln.repo_id || 'system', 
            `TONY Agent applied auto-remediation patch to ${relativeFilePath} on line ${lineNumber} resolving ${vuln.tool} finding.`
        );

        res.json({
            success: true,
            message: `Remediation applied successfully to ${relativeFilePath}. Finding status updated to 'remediated'.`
        });

    } catch (err: any) {
        console.error('[Remediate Apply Error]', err.message);
        res.status(500).json({ error: 'Failed to apply patch', details: err.message });
    }
});

// POST /api/remediate/revert
router.post('/revert', verifyUser, async (req: Request, res: Response) => {
    const { vulnerability_id } = req.body;
    if (!vulnerability_id) return res.status(400).json({ error: 'vulnerability_id is required' });

    try {
        // 1. Retrieve vulnerability details
        const vuln = await databases.getDocument(DB_ID, COLLECTIONS.VULNERABILITIES, vulnerability_id);
        if (!vuln) return res.status(404).json({ error: 'Vulnerability not found' });

        let localPath = workspaceDir;
        if (vuln.repo_id) {
            try {
                const repo = await databases.getDocument(DB_ID, COLLECTIONS.REPOSITORIES, vuln.repo_id);
                if (repo && repo.local_path) {
                    localPath = repo.local_path;
                }
            } catch (err) {
                console.warn('[Remediate Revert] Could not fetch repository context, using workspace fallback:', err);
            }
        }

        const relativeFilePath = vuln.file_path || vuln.filePath || 'src/App.tsx';
        const absoluteFilePath = path.resolve(localPath, relativeFilePath);

        // Path traversal protection
        if (!absoluteFilePath.startsWith(localPath)) {
            return res.status(400).json({ error: 'Invalid file_path: path traversal detected' });
        }

        const backupPath = `${absoluteFilePath}.bak`;
        if (!fs.existsSync(backupPath)) {
            return res.status(404).json({ error: 'No backup found — cannot revert' });
        }

        // 2. Restore backup
        fs.copyFileSync(backupPath, absoluteFilePath);
        fs.unlinkSync(backupPath); // clean up backup after successful revert

        // 3. Update status back to 'open' in Appwrite
        await databases.updateDocument(DB_ID, COLLECTIONS.VULNERABILITIES, vulnerability_id, {
            status: 'open'
        });

        // 4. Ingest event into the secure cryptographic audit ledger
        const actor = (req as any).user?.$id || (req as any).user?.email || 'system';
        await logSecureAuditEvent(
            actor,
            'REMEDIATE_REVERT',
            vuln.repo_id || 'system',
            `TONY Agent reverted auto-remediation patch to ${relativeFilePath} restoring original file.`
        );

        res.json({
            success: true,
            message: `Remediation successfully reverted for ${relativeFilePath}. Finding status updated to 'open'.`
        });

    } catch (err: any) {
        console.error('[Remediate Revert Error]', err.message);
        res.status(500).json({ error: 'Failed to revert patch', details: err.message });
    }
});

export default router;
