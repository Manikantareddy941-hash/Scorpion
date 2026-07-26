import express, { Request } from 'express';
import { Models } from 'node-appwrite';
import { databases, DB_ID, COLLECTIONS, Query } from '../lib/appwrite';
import { updateIncidentStatus } from '../services/incidentService';
import { buildPostmortemPatch } from '../services/incidentPostmortem';
import { convertIncidentToIssue } from '../services/incidentFeedbackService';
import { soarRepository } from '../repositories/soarRepository';
import { resolveOwnershipScope, canAccessIncident, TenantAccessError } from '../services/tenancyService';

interface AuthenticatedRequest extends Request<Record<string, string>> {
  user?: Models.User<Models.Preferences>;
}

const router = express.Router();

router.get('/', async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user?.$id || '';
    const { status } = req.query;

    // Union ownership: incidents scoped to a repo the caller can access (shared
    // repo-RBAC visibility), plus tenant-scoped incidents owned directly by the
    // caller (APM/correlation, which belong to no single repo).
    const scope = await resolveOwnershipScope(req, userId);
    const reposRes = await databases.listDocuments(DB_ID, COLLECTIONS.REPOSITORIES, [
      Query.equal(scope.field, scope.value),
      Query.limit(500)
    ]);
    const repoIds = reposRes.documents.map((r) => r.$id);
    const owner = repoIds.length > 0
      ? Query.or([Query.equal('repo_id', repoIds), Query.equal('user_id', userId)])
      : Query.equal('user_id', userId);

    const filters = [
      owner,
      ...(status ? [Query.equal('status', status as string)] : [Query.orderDesc('$createdAt'), Query.limit(100)])
    ];
    const result = await databases.listDocuments(DB_ID, COLLECTIONS.INCIDENTS, filters);
    res.json(result);
  } catch (err) {
    if (err instanceof TenantAccessError) return res.status(403).json({ error: 'Access denied' });
    res.status(500).json({ error: 'Failed to fetch incidents' });
  }
});

router.patch('/:id/status', async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user?.$id;
    const existing = await databases.getDocument(DB_ID, COLLECTIONS.INCIDENTS, req.params.id);
    if (!(await canAccessIncident(existing, userId))) {
      return res.status(403).json({ error: 'You do not have access to this incident' });
    }

    const { status, assignee } = req.body;
    const doc = await updateIncidentStatus(req.params.id, status, assignee);
    res.json(doc);
  } catch {
    res.status(500).json({ error: 'Failed to update incident' });
  }
});

router.delete('/:id', async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user?.$id;
    const existing = await databases.getDocument(DB_ID, COLLECTIONS.INCIDENTS, req.params.id);
    if (!(await canAccessIncident(existing, userId))) {
      return res.status(403).json({ error: 'You do not have access to this incident' });
    }

    await databases.deleteDocument(DB_ID, COLLECTIONS.INCIDENTS, req.params.id);
    res.json({ deleted: true });
  } catch {
    res.status(500).json({ error: 'Failed to delete incident' });
  }
});

// Blameless post-mortem: only after containment (resolved), only by the owner.
router.patch('/:id/postmortem', async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user?.$id;
    let incident: Record<string, unknown>;
    try {
      incident = await databases.getDocument(DB_ID, COLLECTIONS.INCIDENTS, req.params.id) as unknown as Record<string, unknown>;
    } catch {
      return res.status(404).json({ error: 'Incident not found' });
    }
    if (!(await canAccessIncident(incident, userId))) return res.status(403).json({ error: 'Forbidden' });
    if (incident.status !== 'resolved') return res.status(400).json({ error: 'Post-mortem requires a resolved incident' });

    const built = buildPostmortemPatch(req.body ?? {});
    if (!built.ok) return res.status(400).json({ error: built.error });

    await databases.updateDocument(DB_ID, COLLECTIONS.INCIDENTS, req.params.id, built.patch);
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'Failed to save post-mortem' });
  }
});

// Loop restart: route the post-mortem's lessons to the Plan backlog.
router.post('/:id/convert-to-issue', async (req: AuthenticatedRequest, res) => {
  try {
    const projectId = req.body?.projectId;
    if (typeof projectId !== 'string' || !projectId) return res.status(400).json({ error: 'projectId is required' });
    const out = await convertIncidentToIssue(projectId, req.params.id, req.user?.$id);
    if (out === 'forbidden') return res.status(403).json({ error: 'Forbidden' });
    if (out === 'not_found') return res.status(404).json({ error: 'Incident not found' });
    if (out === 'not_resolved') return res.status(400).json({ error: 'Incident must be resolved first' });
    if (out === 'no_postmortem') return res.status(400).json({ error: 'Fill in the post-mortem before converting' });
    res.json(out);
  } catch {
    res.status(500).json({ error: 'Failed to convert incident' });
  }
});

// Forensic evidence captured by SOAR for this incident (read-only).
router.get('/:id/evidence', async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user?.$id;
    let incident: Record<string, unknown>;
    try {
      incident = await databases.getDocument(DB_ID, COLLECTIONS.INCIDENTS, req.params.id) as unknown as Record<string, unknown>;
    } catch {
      return res.status(404).json({ error: 'Incident not found' });
    }
    if (!(await canAccessIncident(incident, userId))) return res.status(403).json({ error: 'Forbidden' });

    const rows = await soarRepository.listEvidenceForIncident(req.params.id);
    res.json(rows.map((r) => {
      let evidence: unknown = r.result ?? null;
      if (typeof r.result === 'string') { try { evidence = JSON.parse(r.result); } catch { /* keep raw */ } }
      return { actionId: r.id, playbookName: r.playbookName, createdAt: r.createdAt, evidence };
    }));
  } catch {
    res.status(500).json({ error: 'Failed to load evidence' });
  }
});

export default router;
