import { Router, Response, Request, NextFunction } from 'express';
import { Models, ID } from 'node-appwrite';
import { databases, DB_ID, COLLECTIONS, Query } from '../lib/appwrite';

interface AuthenticatedRequest extends Request<Record<string, string>> {
    user?: Models.User<Models.Preferences>;
}

const router = Router();

/** Chat transcripts are conversational, not archival; this bounds one document. */
const MAX_MESSAGES_BYTES = 256 * 1024;

/**
 * Loads a session if it belongs to the caller, otherwise null.
 *
 * 404 rather than 403 on someone else's session: a 403 confirms the id exists.
 * Chat transcripts are freeform user text and can hold anything the user typed
 * at the assistant, so confirming one exists is worth avoiding on its own.
 */
async function loadOwnSession(id: string, userId: string) {
    const doc = await databases.getDocument(DB_ID, COLLECTIONS.CHAT_SESSIONS, id).catch(() => null);
    return doc && doc.userId === userId ? doc : null;
}

router.get('/sessions', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        const result = await databases.listDocuments(DB_ID, COLLECTIONS.CHAT_SESSIONS, [
            Query.equal('userId', req.user!.$id),
            Query.orderDesc('$updatedAt'),
            Query.limit(30),
        ]);
        res.json(result);
    } catch (err) {
        next(err);
    }
});

router.post('/sessions', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        const { title, messages } = req.body ?? {};
        if (typeof messages !== 'string') {
            return res.status(400).json({ error: 'messages must be a JSON string' });
        }
        if (messages.length > MAX_MESSAGES_BYTES) {
            return res.status(413).json({ error: 'Conversation is too large to store' });
        }

        const doc = await databases.createDocument(DB_ID, COLLECTIONS.CHAT_SESSIONS, ID.unique(), {
            sessionId: ID.unique(),
            userId: req.user!.$id,
            title: String(title || 'Untitled chat').slice(0, 256),
            messages,
            createdAt: new Date().toISOString(),
        });
        res.status(201).json(doc);
    } catch (err) {
        next(err);
    }
});

router.patch('/sessions/:id', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        const { messages } = req.body ?? {};
        if (typeof messages !== 'string') {
            return res.status(400).json({ error: 'messages must be a JSON string' });
        }
        if (messages.length > MAX_MESSAGES_BYTES) {
            return res.status(413).json({ error: 'Conversation is too large to store' });
        }

        if (!(await loadOwnSession(req.params.id, req.user!.$id))) {
            return res.status(404).json({ error: 'Chat session not found' });
        }

        const doc = await databases.updateDocument(DB_ID, COLLECTIONS.CHAT_SESSIONS, req.params.id, { messages });
        res.json(doc);
    } catch (err) {
        next(err);
    }
});

router.delete('/sessions/:id', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        if (!(await loadOwnSession(req.params.id, req.user!.$id))) {
            return res.status(404).json({ error: 'Chat session not found' });
        }

        await databases.deleteDocument(DB_ID, COLLECTIONS.CHAT_SESSIONS, req.params.id);
        res.json({ message: 'Chat session deleted' });
    } catch (err) {
        next(err);
    }
});

export default router;
