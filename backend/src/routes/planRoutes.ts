import { Router, Response, Request, NextFunction } from 'express';
import { Models } from 'node-appwrite';
import { databases, DB_ID, COLLECTIONS, Query, ID } from '../lib/appwrite';
import fs from 'fs/promises';
import path from 'path';

interface AuthenticatedRequest extends Request {
  user?: Models.User<Models.Preferences> & { $id: string };
}

const router = Router();
const MOCK_DB_PATH = path.join(process.cwd(), 'scratch', 'plan_mock_db.json');

// Interface structures for Plan Module
interface Project {
  $id: string;
  name: string;
  repoId: string;
  type: 'kanban' | 'scrum';
  createdAt: string;
}

interface Epic {
  $id: string;
  projectId: string;
  title: string;
  color: string;
  startDate?: string;
  endDate?: string;
  status: string;
}

interface Sprint {
  $id: string;
  projectId: string;
  name: string;
  goal?: string;
  startDate?: string;
  endDate?: string;
  status: 'planned' | 'active' | 'completed';
}

interface Issue {
  $id: string;
  projectId: string;
  epicId?: string | null;
  sprintId?: string | null;
  type: 'epic' | 'story' | 'task' | 'bug' | 'subtask';
  title: string;
  description?: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
  status: 'backlog' | 'todo' | 'inprogress' | 'inreview' | 'done';
  assignee?: string;
  storyPoints?: number;
  timeEstimate?: number;
  timeLogged?: number;
  vulnId?: string | null;
  labels?: string[];
  dueDate?: string;
  createdAt: string;
}

interface Comment {
  $id: string;
  issueId: string;
  author: string;
  body: string;
  createdAt: string;
}

interface AutomationRule {
  $id: string;
  projectId: string;
  trigger: string;
  conditions?: string;
  action: string;
}

interface Threat {
  $id: string;
  projectId: string;
  title: string;
  strideCategory: 'Spoofing' | 'Tampering' | 'Repudiation' | 'Information Disclosure' | 'Denial of Service' | 'Elevation of Privilege';
  severity: 'low' | 'medium' | 'high' | 'critical';
  description?: string;
  mitigation?: string;
  status: 'identified' | 'mitigated' | 'accepted';
  issueId?: string;
}

interface PlanSchema {
  projects: Project[];
  epics: Epic[];
  sprints: Sprint[];
  issues: Issue[];
  comments: Comment[];
  automationRules: AutomationRule[];
  threats: Threat[];
}

const defaultMockDb: PlanSchema = {
  projects: [
    { $id: 'proj-1', name: 'Scorpion Defense System', repoId: 'all', type: 'scrum', createdAt: new Date().toISOString() },
    { $id: 'proj-2', name: 'Vulnerability Remediation Kanban', repoId: 'all', type: 'kanban', createdAt: new Date().toISOString() }
  ],
  epics: [
    { $id: 'epic-1', projectId: 'proj-1', title: 'Automate Dependency Checks', color: '#3b82f6', status: 'active' },
    { $id: 'epic-2', projectId: 'proj-1', title: 'Resolve Critical Log4j Violations', color: '#ef4444', status: 'active' },
    { $id: 'epic-3', projectId: 'proj-2', title: 'Developer Security Training', color: '#10b981', status: 'active' }
  ],
  sprints: [
    { $id: 'sprint-1', projectId: 'proj-1', name: 'Sprint 1 - Initial Lockdown', goal: 'Address top CVEs & lock down APIs', startDate: new Date().toISOString(), endDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(), status: 'active' },
    { $id: 'sprint-2', projectId: 'proj-1', name: 'Sprint 2 - CI Integration', goal: 'Build policy engine checks directly into build pipelines', status: 'planned' }
  ],
  issues: [
    { $id: 'issue-1', projectId: 'proj-1', epicId: 'epic-1', sprintId: 'sprint-1', type: 'task', title: 'Integrate Trivy Scanner into GitHub workflows', priority: 'high', status: 'inprogress', assignee: 'dev@scorpion.local', storyPoints: 5, timeEstimate: 12, timeLogged: 4, createdAt: new Date().toISOString() },
    { $id: 'issue-2', projectId: 'proj-1', epicId: 'epic-2', sprintId: 'sprint-1', type: 'bug', title: 'Fix Log4j remote execution vulnerability (CVE-2021-44228)', priority: 'critical', status: 'todo', assignee: 'dev@scorpion.local', storyPoints: 8, timeEstimate: 16, timeLogged: 0, createdAt: new Date().toISOString() },
    { $id: 'issue-3', projectId: 'proj-1', epicId: 'epic-1', sprintId: 'sprint-1', type: 'story', title: 'Provide real-time SBOM export utility in Web Console', priority: 'medium', status: 'inreview', assignee: 'dev@scorpion.local', storyPoints: 3, timeEstimate: 8, timeLogged: 7, createdAt: new Date().toISOString() },
    { $id: 'issue-4', projectId: 'proj-1', epicId: null, sprintId: null, type: 'task', title: 'Verify SSL certificate validation across edge routes', priority: 'low', status: 'backlog', assignee: 'dev@scorpion.local', storyPoints: 2, timeEstimate: 4, timeLogged: 0, createdAt: new Date().toISOString() },
    { $id: 'issue-5', projectId: 'proj-2', epicId: 'epic-3', sprintId: null, type: 'task', title: 'Conduct secure coding training on SQL Injection prevention', priority: 'medium', status: 'inprogress', assignee: 'dev@scorpion.local', storyPoints: 2, timeEstimate: 4, timeLogged: 2, createdAt: new Date().toISOString() }
  ],
  comments: [
    { $id: 'comm-1', issueId: 'issue-1', author: 'Tony AI', body: 'The Trivy scanner will need write access to upload SARIF report files.', createdAt: new Date().toISOString() },
    { $id: 'comm-2', issueId: 'issue-2', author: 'Security Lead', body: 'This is blocking our release gate. Let\'s prioritize patch validation.', createdAt: new Date().toISOString() }
  ],
  automationRules: [
    { $id: 'rule-1', projectId: 'proj-1', trigger: 'vuln_resolved', action: 'auto_create_task' },
    { $id: 'rule-2', projectId: 'proj-1', trigger: 'sprint_ended', action: 'move_to_backlog' }
  ],
  threats: []
};

// Helper: Read mock database from JSON file
async function readMockDb(): Promise<PlanSchema> {
  try {
    await fs.mkdir(path.dirname(MOCK_DB_PATH), { recursive: true });
    const data = await fs.readFile(MOCK_DB_PATH, 'utf-8');
    return JSON.parse(data);
  } catch (err) {
    // If not found, write and return default database
    await fs.writeFile(MOCK_DB_PATH, JSON.stringify(defaultMockDb, null, 2), 'utf-8');
    return defaultMockDb;
  }
}

// Helper: Write mock database to JSON file
async function writeMockDb(db: PlanSchema): Promise<void> {
  await fs.mkdir(path.dirname(MOCK_DB_PATH), { recursive: true });
  await fs.writeFile(MOCK_DB_PATH, JSON.stringify(db, null, 2), 'utf-8');
}

// Helper: Handle Appwrite or Mock Fallback wrapper
async function handleQuery<T>(
  appwriteCall: () => Promise<any>,
  mockCall: () => Promise<T>
): Promise<T> {
  try {
    // Try the cloud DB first. If it's missing database configuration/collections,
    // it will throw an error and we fall back immediately.
    return await appwriteCall();
  } catch (err: any) {
    // Falls back if connection refused, collection not found, or configuration missing
    console.warn('[PlanRoutes] Appwrite database operation failed, using local JSON fallback store:', err.message || err);
    return await mockCall();
  }
}

/* ==========================================================================
   PROJECTS
   ========================================================================== */

// GET projects
router.get('/projects', async (req: AuthenticatedRequest, res: Response) => {
  const data = await handleQuery(
    async () => {
      // In Appwrite, we'd look up the collection. Since we might not have it:
      const docList = await databases.listDocuments(DB_ID, 'plan_projects', [
        Query.orderDesc('createdAt')
      ]);
      return docList.documents;
    },
    async () => {
      const db = await readMockDb();
      return db.projects;
    }
  );
  res.json(data);
});

// POST project
router.post('/projects', async (req: AuthenticatedRequest, res: Response) => {
  const { name, repoId, type } = req.body;
  if (!name) return res.status(400).json({ error: 'Project name is required' });

  const newProj = {
    $id: 'proj-' + Math.random().toString(36).substr(2, 9),
    name,
    repoId: repoId || 'all',
    type: type || 'kanban',
    createdAt: new Date().toISOString()
  };

  const data = await handleQuery(
    async () => {
      return await databases.createDocument(DB_ID, 'plan_projects', ID.unique(), {
        name: newProj.name,
        repoId: newProj.repoId,
        type: newProj.type,
        createdAt: newProj.createdAt
      });
    },
    async () => {
      const db = await readMockDb();
      db.projects.push(newProj);
      await writeMockDb(db);
      return newProj;
    }
  );
  res.status(201).json(data);
});

/* ==========================================================================
   EPICS
   ========================================================================== */

// GET epics
router.get('/projects/:projectId/epics', async (req: AuthenticatedRequest, res: Response) => {
  const { projectId } = req.params;
  const data = await handleQuery(
    async () => {
      const docList = await databases.listDocuments(DB_ID, 'plan_epics', [
        Query.equal('projectId', projectId)
      ]);
      return docList.documents;
    },
    async () => {
      const db = await readMockDb();
      return db.epics.filter(e => e.projectId === projectId);
    }
  );
  res.json(data);
});

// POST epic
router.post('/projects/:projectId/epics', async (req: AuthenticatedRequest, res: Response) => {
  const { projectId } = req.params;
  const { title, color, startDate, endDate } = req.body;
  if (!title) return res.status(400).json({ error: 'Title is required' });

  const newEpic = {
    $id: 'epic-' + Math.random().toString(36).substr(2, 9),
    projectId,
    title,
    color: color || '#3b82f6',
    startDate,
    endDate,
    status: 'active'
  };

  const data = await handleQuery(
    async () => {
      return await databases.createDocument(DB_ID, 'plan_epics', ID.unique(), {
        projectId,
        title: newEpic.title,
        color: newEpic.color,
        startDate: newEpic.startDate,
        endDate: newEpic.endDate,
        status: newEpic.status
      });
    },
    async () => {
      const db = await readMockDb();
      db.epics.push(newEpic);
      await writeMockDb(db);
      return newEpic;
    }
  );
  res.status(201).json(data);
});

/* ==========================================================================
   SPRINTS
   ========================================================================== */

// GET sprints
router.get('/projects/:projectId/sprints', async (req: AuthenticatedRequest, res: Response) => {
  const { projectId } = req.params;
  const data = await handleQuery(
    async () => {
      const docList = await databases.listDocuments(DB_ID, 'plan_sprints', [
        Query.equal('projectId', projectId)
      ]);
      return docList.documents;
    },
    async () => {
      const db = await readMockDb();
      return db.sprints.filter(s => s.projectId === projectId);
    }
  );
  res.json(data);
});

// POST sprint
router.post('/projects/:projectId/sprints', async (req: AuthenticatedRequest, res: Response) => {
  const { projectId } = req.params;
  const { name, goal, startDate, endDate } = req.body;
  if (!name) return res.status(400).json({ error: 'Sprint name is required' });

  const newSprint = {
    $id: 'sprint-' + Math.random().toString(36).substr(2, 9),
    projectId,
    name,
    goal,
    startDate,
    endDate,
    status: 'planned' as const
  };

  const data = await handleQuery(
    async () => {
      return await databases.createDocument(DB_ID, 'plan_sprints', ID.unique(), {
        projectId,
        name: newSprint.name,
        goal: newSprint.goal,
        startDate: newSprint.startDate,
        endDate: newSprint.endDate,
        status: newSprint.status
      });
    },
    async () => {
      const db = await readMockDb();
      db.sprints.push(newSprint);
      await writeMockDb(db);
      return newSprint;
    }
  );
  res.status(201).json(data);
});

// PATCH sprint (start/complete/delete)
router.patch('/sprints/:sprintId', async (req: AuthenticatedRequest, res: Response) => {
  const { sprintId } = req.params;
  const updates = req.body;

  const data = await handleQuery(
    async () => {
      return await databases.updateDocument(DB_ID, 'plan_sprints', sprintId, updates);
    },
    async () => {
      const db = await readMockDb();
      const idx = db.sprints.findIndex(s => s.$id === sprintId);
      if (idx !== -1) {
        db.sprints[idx] = { ...db.sprints[idx], ...updates };

        // Handle Scrum lifecycle: if completing sprint, move open issues back to backlog
        if (updates.status === 'completed') {
          db.issues = db.issues.map(iss => {
            if (iss.sprintId === sprintId && iss.status !== 'done') {
              return { ...iss, sprintId: null };
            }
            return iss;
          });
        }

        await writeMockDb(db);
        return db.sprints[idx];
      }
      return null;
    }
  );

  if (!data) return res.status(404).json({ error: 'Sprint not found' });
  res.json(data);
});

/* ==========================================================================
   ISSUES
   ========================================================================== */

// GET issues
router.get('/projects/:projectId/issues', async (req: AuthenticatedRequest, res: Response) => {
  const { projectId } = req.params;
  const data = await handleQuery(
    async () => {
      const docList = await databases.listDocuments(DB_ID, 'plan_issues', [
        Query.equal('projectId', projectId)
      ]);
      return docList.documents;
    },
    async () => {
      const db = await readMockDb();
      return db.issues.filter(i => i.projectId === projectId);
    }
  );
  res.json(data);
});

// POST issue
router.post('/projects/:projectId/issues', async (req: AuthenticatedRequest, res: Response) => {
  const { projectId } = req.params;
  const {
    type, title, description, priority, status, assignee,
    storyPoints, timeEstimate, epicId, sprintId, vulnId, labels, dueDate
  } = req.body;

  if (!title) return res.status(400).json({ error: 'Title is required' });

  const newIssue: Issue = {
    $id: 'issue-' + Math.random().toString(36).substr(2, 9),
    projectId,
    epicId: epicId || null,
    sprintId: sprintId || null,
    type: type || 'task',
    title,
    description: description || '',
    priority: priority || 'medium',
    status: status || 'todo',
    assignee: assignee || 'dev@scorpion.local',
    storyPoints: storyPoints ? Number(storyPoints) : 0,
    timeEstimate: timeEstimate ? Number(timeEstimate) : 0,
    timeLogged: 0,
    vulnId: vulnId || null,
    labels: labels || [],
    dueDate: dueDate || undefined,
    createdAt: new Date().toISOString()
  };

  const data = await handleQuery(
    async () => {
      return await databases.createDocument(DB_ID, 'plan_issues', ID.unique(), {
        projectId,
        epicId: newIssue.epicId,
        sprintId: newIssue.sprintId,
        type: newIssue.type,
        title: newIssue.title,
        description: newIssue.description,
        priority: newIssue.priority,
        status: newIssue.status,
        assignee: newIssue.assignee,
        storyPoints: newIssue.storyPoints,
        timeEstimate: newIssue.timeEstimate,
        timeLogged: newIssue.timeLogged,
        vulnId: newIssue.vulnId,
        labels: newIssue.labels,
        dueDate: newIssue.dueDate,
        createdAt: newIssue.createdAt
      });
    },
    async () => {
      const db = await readMockDb();
      db.issues.push(newIssue);
      await writeMockDb(db);
      return newIssue;
    }
  );
  res.status(201).json(data);
});

// PATCH issue
router.patch('/issues/:issueId', async (req: AuthenticatedRequest, res: Response) => {
  const { issueId } = req.params;
  const updates = req.body;

  const data = await handleQuery(
    async () => {
      return await databases.updateDocument(DB_ID, 'plan_issues', issueId, updates);
    },
    async () => {
      const db = await readMockDb();
      const idx = db.issues.findIndex(i => i.$id === issueId);
      if (idx !== -1) {
        db.issues[idx] = { ...db.issues[idx], ...updates };
        await writeMockDb(db);
        return db.issues[idx];
      }
      return null;
    }
  );

  if (!data) return res.status(404).json({ error: 'Issue not found' });
  res.json(data);
});

// DELETE issue
router.delete('/issues/:issueId', async (req: AuthenticatedRequest, res: Response) => {
  const { issueId } = req.params;

  const ok = await handleQuery(
    async () => {
      await databases.deleteDocument(DB_ID, 'plan_issues', issueId);
      return true;
    },
    async () => {
      const db = await readMockDb();
      const idx = db.issues.findIndex(i => i.$id === issueId);
      if (idx !== -1) {
        db.issues.splice(idx, 1);
        db.comments = db.comments.filter(c => c.issueId !== issueId);
        await writeMockDb(db);
        return true;
      }
      return false;
    }
  );

  if (!ok) return res.status(404).json({ error: 'Issue not found' });
  res.json({ success: true });
});

/* ==========================================================================
   COMMENTS
   ========================================================================== */

// GET comments for an issue
router.get('/issues/:issueId/comments', async (req: AuthenticatedRequest, res: Response) => {
  const { issueId } = req.params;
  const data = await handleQuery(
    async () => {
      const docList = await databases.listDocuments(DB_ID, 'plan_comments', [
        Query.equal('issueId', issueId)
      ]);
      return docList.documents;
    },
    async () => {
      const db = await readMockDb();
      return db.comments.filter(c => c.issueId === issueId);
    }
  );
  res.json(data);
});

// POST comment
router.post('/issues/:issueId/comments', async (req: AuthenticatedRequest, res: Response) => {
  const { issueId } = req.params;
  const { body } = req.body;
  if (!body) return res.status(400).json({ error: 'Body is required' });

  const newComm = {
    $id: 'comm-' + Math.random().toString(36).substr(2, 9),
    issueId,
    author: req.user?.email || 'dev@scorpion.local',
    body,
    createdAt: new Date().toISOString()
  };

  const data = await handleQuery(
    async () => {
      return await databases.createDocument(DB_ID, 'plan_comments', ID.unique(), {
        issueId,
        author: newComm.author,
        body: newComm.body,
        createdAt: newComm.createdAt
      });
    },
    async () => {
      const db = await readMockDb();
      db.comments.push(newComm);
      await writeMockDb(db);
      return newComm;
    }
  );
  res.status(201).json(data);
});

/* ==========================================================================
   AUTOMATION RULES
   ========================================================================== */

// GET automation rules
router.get('/projects/:projectId/automation-rules', async (req: AuthenticatedRequest, res: Response) => {
  const { projectId } = req.params;
  const data = await handleQuery(
    async () => {
      const docList = await databases.listDocuments(DB_ID, 'plan_automation_rules', [
        Query.equal('projectId', projectId)
      ]);
      return docList.documents;
    },
    async () => {
      const db = await readMockDb();
      return db.automationRules.filter(r => r.projectId === projectId);
    }
  );
  res.json(data);
});

// POST automation rule
router.post('/projects/:projectId/automation-rules', async (req: AuthenticatedRequest, res: Response) => {
  const { projectId } = req.params;
  const { trigger, conditions, action } = req.body;
  if (!trigger || !action) return res.status(400).json({ error: 'Trigger and action are required' });

  const newRule = {
    $id: 'rule-' + Math.random().toString(36).substr(2, 9),
    projectId,
    trigger,
    conditions: conditions || '',
    action
  };

  const data = await handleQuery(
    async () => {
      return await databases.createDocument(DB_ID, 'plan_automation_rules', ID.unique(), {
        projectId,
        trigger: newRule.trigger,
        conditions: newRule.conditions,
        action: newRule.action
      });
    },
    async () => {
      const db = await readMockDb();
      db.automationRules.push(newRule);
      await writeMockDb(db);
      return newRule;
    }
  );
  res.status(201).json(data);
});

/* ==========================================================================
   VULNERABILITIES (to link to issues)
   ========================================================================== */

// GET vulnerabilities/findings from system DB to allow linking them
router.get('/vulnerabilities', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const list = await databases.listDocuments(DB_ID, COLLECTIONS.FINDINGS || 'findings', [
      Query.limit(100)
    ]);
    res.json(list.documents);
  } catch (err: any) {
    // If not config/failing, return empty list
    res.json([]);
  }
});

/* ==========================================================================
   THREATS (Threat Modeling)
   ========================================================================== */

// GET threats for a project
router.get('/projects/:projectId/threats', async (req: AuthenticatedRequest, res: Response) => {
  const { projectId } = req.params;
  const data = await handleQuery(
    async () => {
      const docList = await databases.listDocuments(DB_ID, 'plan_threats', [
        Query.equal('projectId', projectId)
      ]);
      return docList.documents;
    },
    async () => {
      const db = await readMockDb();
      return (db.threats || []).filter(t => t.projectId === projectId);
    }
  );
  res.json(data);
});

// POST threat
router.post('/projects/:projectId/threats', async (req: AuthenticatedRequest, res: Response) => {
  const { projectId } = req.params;
  const { title, strideCategory, severity, description, mitigation } = req.body;
  if (!title || !strideCategory || !severity) {
    return res.status(400).json({ error: 'Title, strideCategory, and severity are required' });
  }

  const newThreat: Threat = {
    $id: 'threat-' + Math.random().toString(36).substr(2, 9),
    projectId,
    title,
    strideCategory,
    severity,
    description: description || '',
    mitigation: mitigation || '',
    status: 'identified'
  };

  const data = await handleQuery(
    async () => {
      return await databases.createDocument(DB_ID, 'plan_threats', ID.unique(), {
        projectId,
        title: newThreat.title,
        strideCategory: newThreat.strideCategory,
        severity: newThreat.severity,
        description: newThreat.description,
        mitigation: newThreat.mitigation,
        status: newThreat.status
      });
    },
    async () => {
      const db = await readMockDb();
      if (!db.threats) db.threats = [];
      db.threats.push(newThreat);
      await writeMockDb(db);
      return newThreat;
    }
  );
  res.status(201).json(data);
});

// PATCH threat
router.patch('/projects/:projectId/threats/:id', async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const updates = req.body;

  const data = await handleQuery(
    async () => {
      return await databases.updateDocument(DB_ID, 'plan_threats', id, updates);
    },
    async () => {
      const db = await readMockDb();
      if (!db.threats) db.threats = [];
      const idx = db.threats.findIndex(t => t.$id === id);
      if (idx !== -1) {
        db.threats[idx] = { ...db.threats[idx], ...updates };
        await writeMockDb(db);
        return db.threats[idx];
      }
      return null;
    }
  );

  if (!data) return res.status(404).json({ error: 'Threat not found' });
  res.json(data);
});

// DELETE threat
router.delete('/projects/:projectId/threats/:id', async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;

  const ok = await handleQuery(
    async () => {
      await databases.deleteDocument(DB_ID, 'plan_threats', id);
      return true;
    },
    async () => {
      const db = await readMockDb();
      if (!db.threats) db.threats = [];
      const idx = db.threats.findIndex(t => t.$id === id);
      if (idx !== -1) {
        db.threats.splice(idx, 1);
        await writeMockDb(db);
        return true;
      }
      return false;
    }
  );

  if (!ok) return res.status(404).json({ error: 'Threat not found' });
  res.json({ success: true });
});

// POST convert threat to ticket
router.post('/projects/:projectId/threats/:id/convert', async (req: AuthenticatedRequest, res: Response) => {
  const { projectId, id } = req.params;

  // 1. Fetch threat details
  const threat = await handleQuery(
    async () => {
      return await databases.getDocument(DB_ID, 'plan_threats', id);
    },
    async () => {
      const db = await readMockDb();
      return (db.threats || []).find(t => t.$id === id) || null;
    }
  );

  if (!threat) return res.status(404).json({ error: 'Threat not found' });

  // 2. Create the ticket (issue)
  const priority: 'critical' | 'high' | 'medium' | 'low' = threat.severity.toLowerCase() === 'critical' ? 'critical' :
                   threat.severity.toLowerCase() === 'high' ? 'high' :
                   threat.severity.toLowerCase() === 'medium' ? 'medium' : 'low';

  const newIssue = {
    projectId,
    title: `[Threat] ${threat.title}`,
    type: 'bug' as const,
    priority,
    storyPoints: 3,
    description: `Threat Category: ${threat.strideCategory}\n\nDescription:\n${threat.description || 'N/A'}\n\nProposed Mitigation:\n${threat.mitigation || 'N/A'}`,
    createdAt: new Date().toISOString()
  };

  const issueData = await handleQuery(
    async () => {
      return await databases.createDocument(DB_ID, 'plan_issues', ID.unique(), {
        projectId: newIssue.projectId,
        title: newIssue.title,
        type: newIssue.type,
        priority: newIssue.priority,
        storyPoints: newIssue.storyPoints,
        description: newIssue.description,
        createdAt: newIssue.createdAt,
        status: 'todo'
      });
    },
    async () => {
      const db = await readMockDb();
      const issueWithId = {
        ...newIssue,
        $id: 'issue-' + Math.random().toString(36).substr(2, 9),
        status: 'todo' as const,
        timeLogged: 0,
        labels: []
      };
      db.issues.push(issueWithId);
      await writeMockDb(db);
      return issueWithId;
    }
  );

  // 3. Update the threat
  const updatedThreat = await handleQuery(
    async () => {
      return await databases.updateDocument(DB_ID, 'plan_threats', id, {
        issueId: issueData.$id,
        status: 'mitigated'
      });
    },
    async () => {
      const db = await readMockDb();
      if (!db.threats) db.threats = [];
      const idx = db.threats.findIndex(t => t.$id === id);
      if (idx !== -1) {
        db.threats[idx].issueId = issueData.$id;
        db.threats[idx].status = 'mitigated';
        await writeMockDb(db);
        return db.threats[idx];
      }
      return null;
    }
  );

  res.json(updatedThreat);
});

export default router;
