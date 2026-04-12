import { Router, Response, Request, NextFunction } from 'express';
import { Models, ID } from 'node-appwrite';
import { databases, DB_ID, COLLECTIONS, Query } from '../lib/appwrite';
import { getRemediationFix, recordFeedback } from '../services/aiService';
import { recordAIEvent, getAIAggregates, getAITrends } from '../services/metricsService';
import { createPullRequest } from '../services/gitProviderService';

interface AuthenticatedRequest extends Request {
    user?: Models.User<Models.Preferences>;
}

const router = Router();

// Remediation
router.post('/vulns/:id/remediate', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        const { id } = req.params;
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
        await recordAIEvent(req.body);
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
        const trends = await getAITrends();
        res.json(trends);
    } catch (err) {
        next(err);
    }
});

// PR Generation
router.post('/fixes/:id/pr', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        const { id } = req.params;
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

// AI Chat Proxy
router.post('/chat', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { messages, systemPrompt } = req.body;
        const apiKey = process.env.GEMINI_API_KEY;

        if (!apiKey) {
            return res.status(500).json({ error: 'Gemini API key not configured on server' });
        }

        const geminiEndpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

        const geminiResponse = await fetch(geminiEndpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                system_instruction: {
                    parts: [{ text: systemPrompt || '' }],
                },
                contents: messages,
                generationConfig: {
                    maxOutputTokens: 1000,
                },
            }),
        });

        if (!geminiResponse.ok) {
            const errData = await geminiResponse.json();
            return res.status(geminiResponse.status).json({ error: errData.error?.message || 'Gemini API error' });
        }

        const data = await geminiResponse.json();
        const reply = data.candidates?.[0]?.content?.parts?.[0]?.text || 'No response received.';
        res.json({ reply });
    } catch (err) {
        next(err);
    }
});

export default router;
