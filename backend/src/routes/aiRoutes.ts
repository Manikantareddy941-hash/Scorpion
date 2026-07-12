import { Router, Response, Request, NextFunction } from 'express';
import { Models } from 'node-appwrite';
import { databases, DB_ID, COLLECTIONS, Query } from '../lib/appwrite';
import { getRemediationFix, recordFeedback } from '../services/aiService';
import { recordAIEvent, getAIAggregates, getAITrends } from '../services/metricsService';
import { createPullRequest } from '../services/gitProviderService';
import { canAccessResource } from '../services/tenancyService';
import { aiLimiter } from '../middleware/rateLimiters';

interface AuthenticatedRequest extends Request {
    user?: Models.User<Models.Preferences>;
}

const router = Router();

// Verifies the caller can access the repo a vulnerability/fix belongs to.
// Throws-by-returning-null on any lookup failure so callers fail closed.
const assertVulnAccess = async (vulnerabilityId: string, userId?: string): Promise<boolean> => {
    try {
        const vuln = await databases.getDocument(DB_ID, COLLECTIONS.VULNERABILITIES, vulnerabilityId);
        if (!vuln.repo_id) return false;
        const repo = await databases.getDocument(DB_ID, COLLECTIONS.REPOSITORIES, vuln.repo_id);
        return canAccessResource(repo, userId);
    } catch {
        return false;
    }
};

const assertFixAccess = async (fixId: string, userId?: string): Promise<boolean> => {
    try {
        const fix = await databases.getDocument(DB_ID, COLLECTIONS.VULNERABILITY_FIXES, fixId);
        if (!fix.vulnerability_id) return false;
        return assertVulnAccess(fix.vulnerability_id, userId);
    } catch {
        return false;
    }
};

// Remediation
router.post('/vulns/:id/remediate', aiLimiter, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        const { id } = req.params;
        if (!(await assertVulnAccess(id, req.user?.$id))) {
            return res.status(403).json({ error: 'You do not have access to this vulnerability' });
        }
        const fix = await getRemediationFix(id);
        res.json(fix);
    } catch (err) {
        next(err);
    }
});

router.post('/vulns/:id/feedback', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        const { id } = req.params;
        const { feedback } = req.body;

        if (!(await assertVulnAccess(id, req.user?.$id))) {
            return res.status(403).json({ error: 'You do not have access to this vulnerability' });
        }

        const response = await databases.listDocuments(DB_ID, COLLECTIONS.VULNERABILITY_FIXES, [
            Query.equal('vulnerability_id', id),
            Query.limit(1)
        ]);

        if (response.total === 0) return res.status(404).json({ error: 'No fix found for this vulnerability' });

        const fix = response.documents[0];

        await recordFeedback(fix.$id, feedback);
        res.json({ success: true });
    } catch (err) {
        next(err);
    }
});

// Metrics
router.post('/metrics/event', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        await recordAIEvent({ ...req.body, userId: req.user?.$id });
        res.json({ success: true });
    } catch (err) {
        next(err);
    }
});

router.get('/metrics/summary', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        const summary = await getAIAggregates(req.user!.$id);
        res.json(summary);
    } catch (err) {
        next(err);
    }
});

router.get('/metrics/trends', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        const trends = await getAITrends(req.user!.$id);
        res.json(trends);
    } catch (err) {
        next(err);
    }
});

// PR Generation
router.post('/fixes/:id/pr', aiLimiter, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        const { id } = req.params;
        if (!(await assertFixAccess(id, req.user?.$id))) {
            return res.status(403).json({ error: 'You do not have access to this fix' });
        }
        const result = await createPullRequest(id);

        await databases.updateDocument(DB_ID, COLLECTIONS.VULNERABILITY_FIXES, id, {
            pr_url: result.url,
            pr_status: result.status,
            branch_name: result.branch_name
        });

        res.json(result);
    } catch (err) {
        next(err);
    }
});

router.get('/fixes/:id/pr/status', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        const { id } = req.params;
        if (!(await assertFixAccess(id, req.user?.$id))) {
            return res.status(403).json({ error: 'You do not have access to this fix' });
        }
        const data = await databases.getDocument(DB_ID, COLLECTIONS.VULNERABILITY_FIXES, id);

        res.json({
            pr_status: data.pr_status,
            pr_url: data.pr_url,
            branch_name: data.branch_name
        });
    } catch (err) {
        next(err);
    }
});

// AI Chat Proxy — streams Gemini's SSE response straight through to the client
// token-by-token instead of buffering the full reply first.
router.post('/chat', aiLimiter, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { messages, systemPrompt } = req.body;
        const apiKey = process.env.GEMINI_API_KEY;

        if (!apiKey) {
            return res.status(500).json({ error: 'Gemini API key not configured on server' });
        }

        const geminiEndpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse&key=${apiKey}`;

        const geminiResponse = await fetch(geminiEndpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                system_instruction: {
                    parts: [{ text: systemPrompt || '' }],
                },
                contents: messages,
                generationConfig: {
                    // gemini-2.5-flash spends part of this budget on internal
                    // thinking tokens; 1000 left visible answers truncated.
                    maxOutputTokens: 4096,
                },
            }),
        });

        if (!geminiResponse.ok || !geminiResponse.body) {
            const errData = await geminiResponse.json().catch(() => ({}));
            return res.status(geminiResponse.status || 502).json({ error: errData.error?.message || 'Gemini API error' });
        }

        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders();

        const reader = geminiResponse.body.getReader();
        req.on('close', () => reader.cancel().catch(() => {}));

        const decoder = new TextDecoder();
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            res.write(decoder.decode(value, { stream: true }));
        }
        res.end();
    } catch (err) {
        next(err);
    }
});

export default router;
