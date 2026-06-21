import { Router, Response, Request, NextFunction } from 'express';
import { Models } from 'node-appwrite';
import { databases, DB_ID, COLLECTIONS, Query, ID } from '../lib/appwrite';
import fs from 'fs/promises';
import path from 'path';
import { logger } from '../services/logger';
import { sendSecurityAlert } from '../services/notificationService';

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
  user_id?: string;
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
  enabled?: boolean;
  runCount?: number;
  lastRunAt?: string | null;
}

interface AutomationRun {
  $id: string;
  projectId: string;
  ruleId: string;
  trigger: string;
  action: string;
  status: 'success' | 'error';
  message: string;
  issueId?: string;
  createdAt: string;
}

interface SprintSnapshot {
  $id: string;
  projectId: string;
  sprintId: string;
  sprintName: string;
  committedPoints: number;
  completedPoints: number;
  committedIssues: number;
  completedIssues: number;
  startDate?: string;
  endDate?: string;
  closedAt: string;
}

interface Worklog {
  $id: string;
  issueId: string;
  author: string;
  minutes: number;
  comment?: string;
  createdAt: string;
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
  automationRuns: AutomationRun[];
  sprintSnapshots: SprintSnapshot[];
  worklogs: Worklog[];
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
    { $id: 'rule-1', projectId: 'proj-1', trigger: 'vuln_resolved', action: 'auto_create_task', enabled: true, runCount: 0, lastRunAt: null },
    { $id: 'rule-2', projectId: 'proj-1', trigger: 'sprint_ended', action: 'move_to_backlog', enabled: true, runCount: 0, lastRunAt: null }
  ],
  automationRuns: [],
  sprintSnapshots: [],
  worklogs: [],
  threats: []
};

// Helper: Read mock database from JSON file
async function readMockDb(): Promise<PlanSchema> {
  try {
    await fs.mkdir(path.dirname(MOCK_DB_PATH), { recursive: true });
    const data = await fs.readFile(MOCK_DB_PATH, 'utf-8');
    const parsed = JSON.parse(data);
    // Backfill arrays added after a mock DB file was first written, so older
    // files don't throw when the new automation/snapshot/worklog code touches them.
    return {
      projects: parsed.projects ?? [],
      epics: parsed.epics ?? [],
      sprints: parsed.sprints ?? [],
      issues: parsed.issues ?? [],
      comments: parsed.comments ?? [],
      automationRules: parsed.automationRules ?? [],
      automationRuns: parsed.automationRuns ?? [],
      sprintSnapshots: parsed.sprintSnapshots ?? [],
      worklogs: parsed.worklogs ?? [],
      threats: parsed.threats ?? [],
    };
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
    logger.warn('[PlanRoutes] Appwrite database operation failed, using local JSON fallback store:', err.message || err);
    return await mockCall();
  }
}

// Fetches a project's owner (user_id), checking Appwrite then the mock
// fallback store. Returns null if the project doesn't exist in either.
async function getProjectOwner(projectId: string): Promise<string | null> {
  try {
    const doc = await databases.getDocument(DB_ID, 'plan_projects', projectId);
    return doc.user_id ?? null;
  } catch {
    const db = await readMockDb();
    const project = db.projects.find(p => p.$id === projectId);
    return project?.user_id ?? null;
  }
}

// Fetches a sprint's projectId, checking Appwrite then the mock fallback.
async function getSprintProjectId(sprintId: string): Promise<string | null> {
  try {
    const doc = await databases.getDocument(DB_ID, 'plan_sprints', sprintId);
    return doc.projectId ?? null;
  } catch {
    const db = await readMockDb();
    const sprint = db.sprints.find(s => s.$id === sprintId);
    return sprint?.projectId ?? null;
  }
}

// Fetches an issue's projectId, checking Appwrite then the mock fallback.
async function getIssueProjectId(issueId: string): Promise<string | null> {
  try {
    const doc = await databases.getDocument(DB_ID, 'plan_issues', issueId);
    return doc.projectId ?? null;
  } catch {
    const db = await readMockDb();
    const issue = db.issues.find(i => i.$id === issueId);
    return issue?.projectId ?? null;
  }
}

// Throws-by-returning-false unless userId owns the project a resource
// belongs to. Used to gate every projectId-scoped route below.
async function assertProjectAccess(projectId: string, userId?: string): Promise<boolean> {
  if (!userId) return false;
  const ownerId = await getProjectOwner(projectId);
  return ownerId === userId;
}

/* ==========================================================================
   AUTOMATION ENGINE
   These functions actually EXECUTE the stored automation rules when issue /
   sprint lifecycle events happen. Previously rules were saved and displayed
   but never ran; this is the engine behind them. Every execution is recorded
   as an AutomationRun so the UI can show real "last fired" history.
   ========================================================================== */

const AUTOMATION_TRIGGER_LABELS: Record<string, string> = {
  critical_vuln: 'Critical Issue Created',
  vuln_resolved: 'Issue Resolved',
  sprint_ended: 'Sprint Concluded',
};

// Loads a project's automation rules (Appwrite, falling back to the mock store).
async function getProjectRules(projectId: string): Promise<AutomationRule[]> {
  return handleQuery<AutomationRule[]>(
    async () => {
      const docList = await databases.listDocuments(DB_ID, 'plan_automation_rules', [
        Query.equal('projectId', projectId),
      ]);
      return docList.documents as any;
    },
    async () => {
      const db = await readMockDb();
      return db.automationRules.filter(r => r.projectId === projectId);
    }
  );
}

// Persists an execution record and bumps the rule's runCount/lastRunAt counters.
async function recordAutomationRun(
  projectId: string,
  rule: AutomationRule,
  status: 'success' | 'error',
  message: string,
  issueId?: string
): Promise<void> {
  const now = new Date().toISOString();
  const run: AutomationRun = {
    $id: 'run-' + Math.random().toString(36).substr(2, 9),
    projectId,
    ruleId: rule.$id,
    trigger: rule.trigger,
    action: rule.action,
    status,
    message,
    issueId,
    createdAt: now,
  };

  await handleQuery(
    async () => {
      await databases.createDocument(DB_ID, 'plan_automation_runs', ID.unique(), {
        projectId, ruleId: rule.$id, trigger: rule.trigger, action: rule.action,
        status, message, issueId: issueId || '', createdAt: now,
      });
      await databases.updateDocument(DB_ID, 'plan_automation_rules', rule.$id, {
        runCount: (rule.runCount || 0) + 1,
        lastRunAt: now,
      }).catch(() => { /* counters are best-effort */ });
      return true;
    },
    async () => {
      const db = await readMockDb();
      db.automationRuns.unshift(run);
      db.automationRuns = db.automationRuns.slice(0, 200); // cap history
      const idx = db.automationRules.findIndex(r => r.$id === rule.$id);
      if (idx !== -1) {
        db.automationRules[idx].runCount = (db.automationRules[idx].runCount || 0) + 1;
        db.automationRules[idx].lastRunAt = now;
      }
      await writeMockDb(db);
      return true;
    }
  );
}

// Creates a follow-up task issue in the same project (the auto_create_task action).
async function createFollowUpTask(projectId: string, title: string, description: string): Promise<string | undefined> {
  const created: any = await handleQuery(
    async () => {
      return await databases.createDocument(DB_ID, 'plan_issues', ID.unique(), {
        projectId, title, type: 'task', priority: 'high', status: 'todo',
        description, storyPoints: 0, timeEstimate: 0, timeLogged: 0,
        labels: ['automation'], createdAt: new Date().toISOString(),
      });
    },
    async () => {
      const db = await readMockDb();
      const issue: Issue = {
        $id: 'issue-' + Math.random().toString(36).substr(2, 9),
        projectId, epicId: null, sprintId: null, type: 'task', title,
        description, priority: 'high', status: 'todo', assignee: 'dev@scorpion.local',
        storyPoints: 0, timeEstimate: 0, timeLogged: 0, vulnId: null,
        labels: ['automation'], createdAt: new Date().toISOString(),
      };
      db.issues.push(issue);
      await writeMockDb(db);
      return issue;
    }
  );
  return created?.$id;
}

interface AutomationContext {
  issue?: Issue;
  sprint?: Sprint;
  userEmail?: string;
}

// Executes a single rule's action and returns a human-readable result message.
async function executeRuleAction(projectId: string, rule: AutomationRule, ctx: AutomationContext): Promise<string> {
  switch (rule.action) {
    case 'auto_create_task': {
      const sourceTitle = ctx.issue?.title || ctx.sprint?.name || 'item';
      const isResolved = rule.trigger === 'vuln_resolved';
      const title = isResolved ? `Verify remediation: ${sourceTitle}` : `Triage: ${sourceTitle}`;
      const description = `Auto-created by automation rule (trigger: ${AUTOMATION_TRIGGER_LABELS[rule.trigger] || rule.trigger}).` +
        (ctx.issue ? `\n\nSource issue: ${ctx.issue.$id} — ${ctx.issue.title}` : '');
      const newId = await createFollowUpTask(projectId, title, description);
      return `Created follow-up task ${newId || ''} "${title}"`;
    }
    case 'slack_notify': {
      // Real dispatch via the existing security-alert notifier (fire-and-forget).
      const title = ctx.issue
        ? `Automation: ${AUTOMATION_TRIGGER_LABELS[rule.trigger] || rule.trigger} — ${ctx.issue.title}`
        : `Automation: ${AUTOMATION_TRIGGER_LABELS[rule.trigger] || rule.trigger} — ${ctx.sprint?.name || ''}`;
      sendSecurityAlert({
        type: rule.trigger === 'critical_vuln' ? 'threat' : 'gate_blocked',
        title,
        severity: ctx.issue?.priority === 'critical' ? 'CRITICAL' : 'HIGH',
        details: ctx.issue?.description || ctx.sprint?.goal || 'Triggered by a project automation rule.',
        repo_id: 'plan',
      });
      return `Dispatched Slack/Discord notification: "${title}"`;
    }
    case 'move_to_backlog': {
      if (!ctx.sprint) return 'move_to_backlog skipped (no sprint context)';
      let moved = 0;
      await handleQuery(
        async () => {
          const open = await databases.listDocuments(DB_ID, 'plan_issues', [
            Query.equal('sprintId', ctx.sprint!.$id),
          ]);
          for (const iss of open.documents) {
            if (iss.status !== 'done') {
              await databases.updateDocument(DB_ID, 'plan_issues', iss.$id, { sprintId: null });
              moved++;
            }
          }
          return true;
        },
        async () => {
          const db = await readMockDb();
          db.issues = db.issues.map(iss => {
            if (iss.sprintId === ctx.sprint!.$id && iss.status !== 'done') { moved++; return { ...iss, sprintId: null }; }
            return iss;
          });
          await writeMockDb(db);
          return true;
        }
      );
      return `Rolled ${moved} unfinished issue(s) back to the backlog`;
    }
    default:
      return `Unknown action "${rule.action}" — no-op`;
  }
}

// Runs every enabled rule whose trigger matches `event` for this project.
async function runAutomation(projectId: string, event: string, ctx: AutomationContext): Promise<void> {
  try {
    const rules = await getProjectRules(projectId);
    const matching = rules.filter(r => r.trigger === event && r.enabled !== false);
    for (const rule of matching) {
      try {
        const message = await executeRuleAction(projectId, rule, ctx);
        await recordAutomationRun(projectId, rule, 'success', message, ctx.issue?.$id);
        logger.info(`[Automation] Rule ${rule.$id} (${rule.trigger}→${rule.action}) fired: ${message}`);
      } catch (actionErr: any) {
        await recordAutomationRun(projectId, rule, 'error', actionErr.message || 'Action failed', ctx.issue?.$id);
        logger.error(`[Automation] Rule ${rule.$id} action failed:`, actionErr.message);
      }
    }
  } catch (err: any) {
    // Automation must never break the user action that triggered it.
    logger.error('[Automation] Engine failure:', err.message);
  }
}

// Snapshots a sprint's committed-vs-completed story points at the moment it's
// closed, so the velocity/burndown charts have real history even after issues
// roll off into later sprints. Must run BEFORE unfinished issues are moved out.
async function writeSprintSnapshot(projectId: string, sprint: Sprint): Promise<void> {
  try {
    const sprintIssues: Issue[] = await handleQuery(
      async () => {
        const list = await databases.listDocuments(DB_ID, 'plan_issues', [Query.equal('sprintId', sprint.$id)]);
        return list.documents as any;
      },
      async () => (await readMockDb()).issues.filter(i => i.sprintId === sprint.$id)
    );

    const committedPoints = sprintIssues.reduce((acc, i) => acc + (Number(i.storyPoints) || 0), 0);
    const completedPoints = sprintIssues.filter(i => i.status === 'done').reduce((acc, i) => acc + (Number(i.storyPoints) || 0), 0);
    const snapshot: SprintSnapshot = {
      $id: 'snap-' + Math.random().toString(36).substr(2, 9),
      projectId,
      sprintId: sprint.$id,
      sprintName: sprint.name,
      committedPoints,
      completedPoints,
      committedIssues: sprintIssues.length,
      completedIssues: sprintIssues.filter(i => i.status === 'done').length,
      startDate: sprint.startDate,
      endDate: sprint.endDate,
      closedAt: new Date().toISOString(),
    };

    await handleQuery(
      async () => {
        return await databases.createDocument(DB_ID, 'plan_sprint_snapshots', ID.unique(), { ...snapshot } as any);
      },
      async () => {
        const db = await readMockDb();
        // Replace any prior snapshot for this sprint (re-closing) to avoid dupes.
        db.sprintSnapshots = db.sprintSnapshots.filter(s => s.sprintId !== sprint.$id);
        db.sprintSnapshots.push(snapshot);
        await writeMockDb(db);
        return snapshot;
      }
    );
  } catch (err: any) {
    logger.error('[SprintSnapshot] Failed to snapshot sprint velocity:', err.message);
  }
}

// Guaranteed roll-to-backlog of unfinished issues on sprint close (core Scrum
// behaviour, independent of automation rules). Idempotent and works on both the
// Appwrite and mock stores (the original only handled the mock path).
async function rollUnfinishedToBacklog(sprintId: string): Promise<void> {
  try {
    await handleQuery(
      async () => {
        const open = await databases.listDocuments(DB_ID, 'plan_issues', [Query.equal('sprintId', sprintId)]);
        for (const iss of open.documents) {
          if (iss.status !== 'done') {
            await databases.updateDocument(DB_ID, 'plan_issues', iss.$id, { sprintId: null });
          }
        }
        return true;
      },
      async () => {
        const db = await readMockDb();
        db.issues = db.issues.map(iss =>
          iss.sprintId === sprintId && iss.status !== 'done' ? { ...iss, sprintId: null } : iss
        );
        await writeMockDb(db);
        return true;
      }
    );
  } catch (err: any) {
    logger.error('[Sprint] Failed to roll unfinished issues to backlog:', err.message);
  }
}

/* ==========================================================================
   PROJECTS
   ========================================================================== */

// GET projects
router.get('/projects', async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.$id;
  const data = await handleQuery(
    async () => {
      const docList = await databases.listDocuments(DB_ID, 'plan_projects', [
        Query.equal('user_id', userId || ''),
        Query.orderDesc('createdAt')
      ]);
      return docList.documents;
    },
    async () => {
      const db = await readMockDb();
      return db.projects.filter(p => p.user_id === userId);
    }
  );
  res.json(data);
});

// POST project
router.post('/projects', async (req: AuthenticatedRequest, res: Response) => {
  const { name, repoId, type } = req.body;
  if (!name) return res.status(400).json({ error: 'Project name is required' });
  const userId = req.user?.$id;

  const newProj = {
    $id: 'proj-' + Math.random().toString(36).substr(2, 9),
    name,
    repoId: repoId || 'all',
    type: type || 'kanban',
    createdAt: new Date().toISOString(),
    user_id: userId
  };

  const data = await handleQuery(
    async () => {
      return await databases.createDocument(DB_ID, 'plan_projects', ID.unique(), {
        name: newProj.name,
        repoId: newProj.repoId,
        type: newProj.type,
        createdAt: newProj.createdAt,
        user_id: userId
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
  if (!(await assertProjectAccess(projectId, req.user?.$id))) {
    return res.status(403).json({ error: 'You do not have access to this project' });
  }
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
  if (!(await assertProjectAccess(projectId, req.user?.$id))) {
    return res.status(403).json({ error: 'You do not have access to this project' });
  }
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
  if (!(await assertProjectAccess(projectId, req.user?.$id))) {
    return res.status(403).json({ error: 'You do not have access to this project' });
  }
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
  if (!(await assertProjectAccess(projectId, req.user?.$id))) {
    return res.status(403).json({ error: 'You do not have access to this project' });
  }
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
  const sprintProjectId = await getSprintProjectId(sprintId);
  if (!sprintProjectId) return res.status(404).json({ error: 'Sprint not found' });
  if (!(await assertProjectAccess(sprintProjectId, req.user?.$id))) {
    return res.status(403).json({ error: 'You do not have access to this sprint' });
  }
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
        await writeMockDb(db);
        return db.sprints[idx];
      }
      return null;
    }
  );

  if (!data) return res.status(404).json({ error: 'Sprint not found' });

  // On sprint completion: snapshot velocity first (needs the issues still in the
  // sprint), then fire automation rules, then guarantee unfinished issues roll to
  // the backlog regardless of whether a move_to_backlog rule exists.
  if (updates.status === 'completed') {
    await writeSprintSnapshot(sprintProjectId, data as Sprint);
    await runAutomation(sprintProjectId, 'sprint_ended', { sprint: data as Sprint, userEmail: req.user?.email });
    await rollUnfinishedToBacklog(sprintId);
  }

  res.json(data);
});

/* ==========================================================================
   ISSUES
   ========================================================================== */

// GET issues
router.get('/projects/:projectId/issues', async (req: AuthenticatedRequest, res: Response) => {
  const { projectId } = req.params;
  if (!(await assertProjectAccess(projectId, req.user?.$id))) {
    return res.status(403).json({ error: 'You do not have access to this project' });
  }
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
  if (!(await assertProjectAccess(projectId, req.user?.$id))) {
    return res.status(403).json({ error: 'You do not have access to this project' });
  }
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

  // Fire automation: a newly created critical issue is the "Critical Issue Created" trigger.
  const createdIssue: Issue = { ...newIssue, $id: (data as any).$id || newIssue.$id };
  if (createdIssue.priority === 'critical') {
    await runAutomation(projectId, 'critical_vuln', { issue: createdIssue, userEmail: req.user?.email });
  }

  res.status(201).json(data);
});

// PATCH issue
router.patch('/issues/:issueId', async (req: AuthenticatedRequest, res: Response) => {
  const { issueId } = req.params;
  const issueProjectId = await getIssueProjectId(issueId);
  if (!issueProjectId) return res.status(404).json({ error: 'Issue not found' });
  if (!(await assertProjectAccess(issueProjectId, req.user?.$id))) {
    return res.status(403).json({ error: 'You do not have access to this issue' });
  }
  const updates = req.body;

  // Capture the prior status so we only fire the resolve trigger on the actual
  // transition into 'done' (not on every save of an already-done issue).
  let priorStatus: string | undefined;
  try {
    const prior: any = await handleQuery(
      async () => await databases.getDocument(DB_ID, 'plan_issues', issueId),
      async () => (await readMockDb()).issues.find(i => i.$id === issueId) || null
    );
    priorStatus = prior?.status;
  } catch { /* non-fatal */ }

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

  // Fire automation on the transition into 'done' (the "Issue Resolved" trigger).
  if (updates.status === 'done' && priorStatus !== 'done') {
    await runAutomation(issueProjectId, 'vuln_resolved', { issue: data as Issue, userEmail: req.user?.email });
  }

  res.json(data);
});

// DELETE issue
router.delete('/issues/:issueId', async (req: AuthenticatedRequest, res: Response) => {
  const { issueId } = req.params;
  const issueProjectId = await getIssueProjectId(issueId);
  if (!issueProjectId) return res.status(404).json({ error: 'Issue not found' });
  if (!(await assertProjectAccess(issueProjectId, req.user?.$id))) {
    return res.status(403).json({ error: 'You do not have access to this issue' });
  }

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
   WORKLOGS (time tracking)
   ========================================================================== */

// GET worklogs for an issue
router.get('/issues/:issueId/worklogs', async (req: AuthenticatedRequest, res: Response) => {
  const { issueId } = req.params;
  const issueProjectId = await getIssueProjectId(issueId);
  if (!issueProjectId) return res.status(404).json({ error: 'Issue not found' });
  if (!(await assertProjectAccess(issueProjectId, req.user?.$id))) {
    return res.status(403).json({ error: 'You do not have access to this issue' });
  }
  const data = await handleQuery(
    async () => {
      const docList = await databases.listDocuments(DB_ID, 'plan_worklogs', [Query.equal('issueId', issueId)]);
      return docList.documents;
    },
    async () => (await readMockDb()).worklogs.filter(w => w.issueId === issueId)
  );
  res.json(data);
});

// POST worklog — logs time against an issue and increments its timeLogged total.
router.post('/issues/:issueId/worklogs', async (req: AuthenticatedRequest, res: Response) => {
  const { issueId } = req.params;
  const issueProjectId = await getIssueProjectId(issueId);
  if (!issueProjectId) return res.status(404).json({ error: 'Issue not found' });
  if (!(await assertProjectAccess(issueProjectId, req.user?.$id))) {
    return res.status(403).json({ error: 'You do not have access to this issue' });
  }
  const minutes = Number(req.body.minutes);
  const { comment } = req.body;
  if (!minutes || minutes <= 0) return res.status(400).json({ error: 'minutes must be a positive number' });

  const worklog: Worklog = {
    $id: 'wl-' + Math.random().toString(36).substr(2, 9),
    issueId,
    author: req.user?.email || 'dev@scorpion.local',
    minutes,
    comment: comment || '',
    createdAt: new Date().toISOString(),
  };

  const data = await handleQuery(
    async () => {
      const created = await databases.createDocument(DB_ID, 'plan_worklogs', ID.unique(), {
        issueId, author: worklog.author, minutes, comment: worklog.comment, createdAt: worklog.createdAt,
      });
      // Increment the issue's logged-hours total (stored in hours to match the UI).
      const issue = await databases.getDocument(DB_ID, 'plan_issues', issueId);
      await databases.updateDocument(DB_ID, 'plan_issues', issueId, {
        timeLogged: (Number(issue.timeLogged) || 0) + minutes / 60,
      });
      return created;
    },
    async () => {
      const db = await readMockDb();
      db.worklogs.push(worklog);
      const idx = db.issues.findIndex(i => i.$id === issueId);
      if (idx !== -1) {
        db.issues[idx].timeLogged = (Number(db.issues[idx].timeLogged) || 0) + minutes / 60;
      }
      await writeMockDb(db);
      return worklog;
    }
  );
  res.status(201).json(data);
});

/* ==========================================================================
   COMMENTS
   ========================================================================== */

// GET comments for an issue
router.get('/issues/:issueId/comments', async (req: AuthenticatedRequest, res: Response) => {
  const { issueId } = req.params;
  const issueProjectId = await getIssueProjectId(issueId);
  if (!issueProjectId) return res.status(404).json({ error: 'Issue not found' });
  if (!(await assertProjectAccess(issueProjectId, req.user?.$id))) {
    return res.status(403).json({ error: 'You do not have access to this issue' });
  }
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
  const issueProjectId = await getIssueProjectId(issueId);
  if (!issueProjectId) return res.status(404).json({ error: 'Issue not found' });
  if (!(await assertProjectAccess(issueProjectId, req.user?.$id))) {
    return res.status(403).json({ error: 'You do not have access to this issue' });
  }
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
  if (!(await assertProjectAccess(projectId, req.user?.$id))) {
    return res.status(403).json({ error: 'You do not have access to this project' });
  }
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
  if (!(await assertProjectAccess(projectId, req.user?.$id))) {
    return res.status(403).json({ error: 'You do not have access to this project' });
  }
  const { trigger, conditions, action } = req.body;
  if (!trigger || !action) return res.status(400).json({ error: 'Trigger and action are required' });

  const newRule: AutomationRule = {
    $id: 'rule-' + Math.random().toString(36).substr(2, 9),
    projectId,
    trigger,
    conditions: conditions || '',
    action,
    enabled: true,
    runCount: 0,
    lastRunAt: null,
  };

  const data = await handleQuery(
    async () => {
      return await databases.createDocument(DB_ID, 'plan_automation_rules', ID.unique(), {
        projectId,
        trigger: newRule.trigger,
        conditions: newRule.conditions,
        action: newRule.action,
        enabled: true,
        runCount: 0,
        lastRunAt: null,
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

// DELETE automation rule
router.delete('/projects/:projectId/automation-rules/:ruleId', async (req: AuthenticatedRequest, res: Response) => {
  const { projectId, ruleId } = req.params;
  if (!(await assertProjectAccess(projectId, req.user?.$id))) {
    return res.status(403).json({ error: 'You do not have access to this project' });
  }

  const ok = await handleQuery(
    async () => {
      await databases.deleteDocument(DB_ID, 'plan_automation_rules', ruleId);
      return true;
    },
    async () => {
      const db = await readMockDb();
      const idx = db.automationRules.findIndex(r => r.$id === ruleId);
      if (idx !== -1) {
        db.automationRules.splice(idx, 1);
        await writeMockDb(db);
        return true;
      }
      return false;
    }
  );

  if (!ok) return res.status(404).json({ error: 'Rule not found' });
  res.json({ success: true });
});

// GET automation run history (proof the rules actually fire)
router.get('/projects/:projectId/automation-runs', async (req: AuthenticatedRequest, res: Response) => {
  const { projectId } = req.params;
  if (!(await assertProjectAccess(projectId, req.user?.$id))) {
    return res.status(403).json({ error: 'You do not have access to this project' });
  }
  const data = await handleQuery(
    async () => {
      const docList = await databases.listDocuments(DB_ID, 'plan_automation_runs', [
        Query.equal('projectId', projectId),
        Query.orderDesc('createdAt'),
        Query.limit(50),
      ]);
      return docList.documents;
    },
    async () => {
      const db = await readMockDb();
      return db.automationRuns
        .filter(r => r.projectId === projectId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, 50);
    }
  );
  res.json(data);
});

/* ==========================================================================
   SPRINT SNAPSHOTS (real velocity history)
   ========================================================================== */

// GET historical sprint velocity snapshots for a project
router.get('/projects/:projectId/sprint-snapshots', async (req: AuthenticatedRequest, res: Response) => {
  const { projectId } = req.params;
  if (!(await assertProjectAccess(projectId, req.user?.$id))) {
    return res.status(403).json({ error: 'You do not have access to this project' });
  }
  const data = await handleQuery(
    async () => {
      const docList = await databases.listDocuments(DB_ID, 'plan_sprint_snapshots', [
        Query.equal('projectId', projectId),
        Query.orderAsc('closedAt'),
        Query.limit(100),
      ]);
      return docList.documents;
    },
    async () => {
      const db = await readMockDb();
      return db.sprintSnapshots
        .filter(s => s.projectId === projectId)
        .sort((a, b) => a.closedAt.localeCompare(b.closedAt));
    }
  );
  res.json(data);
});

/* ==========================================================================
   VULNERABILITIES (to link to issues)
   ========================================================================== */

// GET vulnerabilities/findings from system DB to allow linking them
router.get('/vulnerabilities', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.$id;
    const repos = await databases.listDocuments(DB_ID, COLLECTIONS.REPOSITORIES, [Query.equal('user_id', userId || '')]);
    const repoIds = repos.documents.map((r: any) => r.$id);
    if (repoIds.length === 0) return res.json([]);

    const list = await databases.listDocuments(DB_ID, COLLECTIONS.FINDINGS || 'findings', [
      Query.equal('repo_id', repoIds),
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
  if (!(await assertProjectAccess(projectId, req.user?.$id))) {
    return res.status(403).json({ error: 'You do not have access to this project' });
  }
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
  if (!(await assertProjectAccess(projectId, req.user?.$id))) {
    return res.status(403).json({ error: 'You do not have access to this project' });
  }
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
  const { id, projectId } = req.params;
  if (!(await assertProjectAccess(projectId, req.user?.$id))) {
    return res.status(403).json({ error: 'You do not have access to this project' });
  }
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
  const { id, projectId } = req.params;
  if (!(await assertProjectAccess(projectId, req.user?.$id))) {
    return res.status(403).json({ error: 'You do not have access to this project' });
  }

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
  if (!(await assertProjectAccess(projectId, req.user?.$id))) {
    return res.status(403).json({ error: 'You do not have access to this project' });
  }

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
