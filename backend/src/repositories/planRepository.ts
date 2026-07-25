import fs from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';
import { databases, DB_ID, COLLECTIONS, Query, ID } from '../lib/appwrite';
import { logger } from '../services/logger';
import {
  PlanSchema, Project, Epic, Sprint, Issue, Comment, AutomationRule,
  AutomationRun, SprintSnapshot, Worklog, Threat
} from '../types/plan.types';

const MOCK_DB_PATH = path.join(process.cwd(), 'scratch', 'plan_mock_db.json');

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

async function readMockDb(): Promise<PlanSchema> {
  try {
    await fs.mkdir(path.dirname(MOCK_DB_PATH), { recursive: true });
    const data = await fs.readFile(MOCK_DB_PATH, 'utf-8');
    const parsed = JSON.parse(data);
    // Backfill arrays added after a mock DB file was first written, so older
    // files don't throw when the automation/snapshot/worklog code touches them.
    return {
      ...parsed,
      automationRuns: parsed.automationRuns ?? [],
      sprintSnapshots: parsed.sprintSnapshots ?? [],
      worklogs: parsed.worklogs ?? [],
      threats: parsed.threats ?? [],
    };
  } catch {
    await fs.writeFile(MOCK_DB_PATH, JSON.stringify(defaultMockDb, null, 2), 'utf-8');
    return defaultMockDb;
  }
}

async function writeMockDb(db: PlanSchema): Promise<void> {
  await fs.mkdir(path.dirname(MOCK_DB_PATH), { recursive: true });
  await fs.writeFile(MOCK_DB_PATH, JSON.stringify(db, null, 2), 'utf-8');
}

/**
 * Tries the Appwrite cloud DB first. Falls back to the local JSON store on
 * any failure (missing config, missing collection, connection refused).
 */
async function handleQuery<T>(appwriteCall: () => Promise<T>, mockCall: () => Promise<T>): Promise<T> {
  try {
    return await appwriteCall();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn('[PlanRepository] Appwrite operation failed, using local JSON fallback store:', message);
    return await mockCall();
  }
}

function randomId(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
}

export const planRepository = {
  readMockDb,
  writeMockDb,

  async getProjectOwner(projectId: string): Promise<string | null> {
    try {
      const doc = await databases.getDocument(DB_ID, 'plan_projects', projectId);
      return doc.user_id ?? null;
    } catch {
      const db = await readMockDb();
      return db.projects.find(p => p.$id === projectId)?.user_id ?? null;
    }
  },

  async getSprintProjectId(sprintId: string): Promise<string | null> {
    try {
      const doc = await databases.getDocument(DB_ID, 'plan_sprints', sprintId);
      return doc.projectId ?? null;
    } catch {
      const db = await readMockDb();
      return db.sprints.find(s => s.$id === sprintId)?.projectId ?? null;
    }
  },

  async getIssueProjectId(issueId: string): Promise<string | null> {
    try {
      const doc = await databases.getDocument(DB_ID, 'plan_issues', issueId);
      return doc.projectId ?? null;
    } catch {
      const db = await readMockDb();
      return db.issues.find(i => i.$id === issueId)?.projectId ?? null;
    }
  },

  async listProjects(userId: string | undefined): Promise<Project[]> {
    return handleQuery(
      async () => {
        const docList = await databases.listDocuments(DB_ID, 'plan_projects', [
          Query.equal('user_id', userId || ''),
          Query.orderDesc('createdAt')
        ]);
        return docList.documents as unknown as Project[];
      },
      async () => {
        const db = await readMockDb();
        return db.projects.filter(p => p.user_id === userId);
      }
    );
  },

  async createProject(input: { name: string; repoId?: string; type?: 'kanban' | 'scrum'; userId?: string }): Promise<Project> {
    const newProj: Project = {
      $id: randomId('proj'),
      name: input.name,
      repoId: input.repoId || 'all',
      type: input.type || 'kanban',
      createdAt: new Date().toISOString(),
      user_id: input.userId
    };
    return handleQuery(
      async () => {
        const doc = await databases.createDocument(DB_ID, 'plan_projects', ID.unique(), {
          name: newProj.name, repoId: newProj.repoId, type: newProj.type,
          createdAt: newProj.createdAt, user_id: newProj.user_id
        });
        return doc as unknown as Project;
      },
      async () => {
        const db = await readMockDb();
        db.projects.push(newProj);
        await writeMockDb(db);
        return newProj;
      }
    );
  },

  async listEpics(projectId: string): Promise<Epic[]> {
    return handleQuery(
      async () => {
        const docList = await databases.listDocuments(DB_ID, 'plan_epics', [Query.equal('projectId', projectId)]);
        return docList.documents as unknown as Epic[];
      },
      async () => {
        const db = await readMockDb();
        return db.epics.filter(e => e.projectId === projectId);
      }
    );
  },

  async createEpic(projectId: string, input: { title: string; color?: string; startDate?: string; endDate?: string }): Promise<Epic> {
    const newEpic: Epic = {
      $id: randomId('epic'),
      projectId,
      title: input.title,
      color: input.color || '#3b82f6',
      startDate: input.startDate,
      endDate: input.endDate,
      status: 'active'
    };
    return handleQuery(
      async () => {
        const doc = await databases.createDocument(DB_ID, 'plan_epics', ID.unique(), {
          projectId, title: newEpic.title, color: newEpic.color,
          startDate: newEpic.startDate, endDate: newEpic.endDate, status: newEpic.status
        });
        return doc as unknown as Epic;
      },
      async () => {
        const db = await readMockDb();
        db.epics.push(newEpic);
        await writeMockDb(db);
        return newEpic;
      }
    );
  },

  async listSprints(projectId: string): Promise<Sprint[]> {
    return handleQuery(
      async () => {
        const docList = await databases.listDocuments(DB_ID, 'plan_sprints', [Query.equal('projectId', projectId)]);
        return docList.documents as unknown as Sprint[];
      },
      async () => {
        const db = await readMockDb();
        return db.sprints.filter(s => s.projectId === projectId);
      }
    );
  },

  async createSprint(projectId: string, input: { name: string; goal?: string; startDate?: string; endDate?: string }): Promise<Sprint> {
    const newSprint: Sprint = {
      $id: randomId('sprint'),
      projectId,
      name: input.name,
      goal: input.goal,
      startDate: input.startDate,
      endDate: input.endDate,
      status: 'planned'
    };
    return handleQuery(
      async () => {
        const doc = await databases.createDocument(DB_ID, 'plan_sprints', ID.unique(), {
          projectId, name: newSprint.name, goal: newSprint.goal,
          startDate: newSprint.startDate, endDate: newSprint.endDate, status: newSprint.status
        });
        return doc as unknown as Sprint;
      },
      async () => {
        const db = await readMockDb();
        db.sprints.push(newSprint);
        await writeMockDb(db);
        return newSprint;
      }
    );
  },

  async updateSprint(sprintId: string, updates: Partial<Sprint>): Promise<Sprint | null> {
    return handleQuery(
      async () => {
        const doc = await databases.updateDocument(DB_ID, 'plan_sprints', sprintId, updates);
        return doc as unknown as Sprint;
      },
      async () => {
        const db = await readMockDb();
        const idx = db.sprints.findIndex(s => s.$id === sprintId);
        if (idx === -1) return null;
        db.sprints[idx] = { ...db.sprints[idx], ...updates };

        if (updates.status === 'completed') {
          db.issues = db.issues.map(iss =>
            iss.sprintId === sprintId && iss.status !== 'done' ? { ...iss, sprintId: null } : iss
          );
        }

        await writeMockDb(db);
        return db.sprints[idx];
      }
    );
  },

  async listIssues(projectId: string): Promise<Issue[]> {
    return handleQuery(
      async () => {
        const docList = await databases.listDocuments(DB_ID, 'plan_issues', [Query.equal('projectId', projectId)]);
        return docList.documents as unknown as Issue[];
      },
      async () => {
        const db = await readMockDb();
        return db.issues.filter(i => i.projectId === projectId);
      }
    );
  },

  async createIssue(issue: Issue): Promise<Issue> {
    return handleQuery(
      async () => {
        const doc = await databases.createDocument(DB_ID, 'plan_issues', ID.unique(), {
          projectId: issue.projectId, epicId: issue.epicId, sprintId: issue.sprintId, type: issue.type,
          title: issue.title, description: issue.description, priority: issue.priority, status: issue.status,
          assignee: issue.assignee, storyPoints: issue.storyPoints, timeEstimate: issue.timeEstimate,
          timeLogged: issue.timeLogged, vulnId: issue.vulnId, labels: issue.labels, dueDate: issue.dueDate,
          createdAt: issue.createdAt
        });
        return doc as unknown as Issue;
      },
      async () => {
        const db = await readMockDb();
        db.issues.push(issue);
        await writeMockDb(db);
        return issue;
      }
    );
  },

  async updateIssue(issueId: string, updates: Partial<Issue>): Promise<Issue | null> {
    return handleQuery(
      async () => {
        const doc = await databases.updateDocument(DB_ID, 'plan_issues', issueId, updates);
        return doc as unknown as Issue;
      },
      async () => {
        const db = await readMockDb();
        const idx = db.issues.findIndex(i => i.$id === issueId);
        if (idx === -1) return null;
        db.issues[idx] = { ...db.issues[idx], ...updates };
        await writeMockDb(db);
        return db.issues[idx];
      }
    );
  },

  async deleteIssue(issueId: string): Promise<boolean> {
    return handleQuery(
      async () => {
        await databases.deleteDocument(DB_ID, 'plan_issues', issueId);
        return true;
      },
      async () => {
        const db = await readMockDb();
        const idx = db.issues.findIndex(i => i.$id === issueId);
        if (idx === -1) return false;
        db.issues.splice(idx, 1);
        db.comments = db.comments.filter(c => c.issueId !== issueId);
        await writeMockDb(db);
        return true;
      }
    );
  },

  async listComments(issueId: string): Promise<Comment[]> {
    return handleQuery(
      async () => {
        const docList = await databases.listDocuments(DB_ID, 'plan_comments', [Query.equal('issueId', issueId)]);
        return docList.documents as unknown as Comment[];
      },
      async () => {
        const db = await readMockDb();
        return db.comments.filter(c => c.issueId === issueId);
      }
    );
  },

  async createComment(issueId: string, input: { author: string; body: string }): Promise<Comment> {
    const newComment: Comment = {
      $id: randomId('comm'),
      issueId,
      author: input.author,
      body: input.body,
      createdAt: new Date().toISOString()
    };
    return handleQuery(
      async () => {
        const doc = await databases.createDocument(DB_ID, 'plan_comments', ID.unique(), {
          issueId, author: newComment.author, body: newComment.body, createdAt: newComment.createdAt
        });
        return doc as unknown as Comment;
      },
      async () => {
        const db = await readMockDb();
        db.comments.push(newComment);
        await writeMockDb(db);
        return newComment;
      }
    );
  },

  async getIssue(issueId: string): Promise<Issue | null> {
    return handleQuery(
      async () => {
        const doc = await databases.getDocument(DB_ID, 'plan_issues', issueId);
        return doc as unknown as Issue;
      },
      async () => {
        const db = await readMockDb();
        return db.issues.find(i => i.$id === issueId) || null;
      }
    );
  },

  async listIssuesBySprint(sprintId: string): Promise<Issue[]> {
    return handleQuery(
      async () => {
        const docList = await databases.listDocuments(DB_ID, 'plan_issues', [Query.equal('sprintId', sprintId)]);
        return docList.documents as unknown as Issue[];
      },
      async () => {
        const db = await readMockDb();
        return db.issues.filter(i => i.sprintId === sprintId);
      }
    );
  },

  async listWorklogs(issueId: string): Promise<Worklog[]> {
    return handleQuery(
      async () => {
        const docList = await databases.listDocuments(DB_ID, 'plan_worklogs', [Query.equal('issueId', issueId)]);
        return docList.documents as unknown as Worklog[];
      },
      async () => {
        const db = await readMockDb();
        return db.worklogs.filter(w => w.issueId === issueId);
      }
    );
  },

  /** Persists a worklog and increments the issue's timeLogged total (stored in hours to match the UI). */
  async createWorklog(issueId: string, input: { author: string; minutes: number; comment?: string }): Promise<Worklog> {
    const worklog: Worklog = {
      $id: randomId('wl'),
      issueId,
      author: input.author,
      minutes: input.minutes,
      comment: input.comment || '',
      createdAt: new Date().toISOString(),
    };
    return handleQuery(
      async () => {
        const created = await databases.createDocument(DB_ID, 'plan_worklogs', ID.unique(), {
          issueId, author: worklog.author, minutes: worklog.minutes, comment: worklog.comment, createdAt: worklog.createdAt,
        });
        const issue = await databases.getDocument(DB_ID, 'plan_issues', issueId);
        await databases.updateDocument(DB_ID, 'plan_issues', issueId, {
          timeLogged: (Number(issue.timeLogged) || 0) + input.minutes / 60,
        });
        return created as unknown as Worklog;
      },
      async () => {
        const db = await readMockDb();
        db.worklogs.push(worklog);
        const idx = db.issues.findIndex(i => i.$id === issueId);
        if (idx !== -1) {
          db.issues[idx] = { ...db.issues[idx], timeLogged: (Number(db.issues[idx].timeLogged) || 0) + input.minutes / 60 };
        }
        await writeMockDb(db);
        return worklog;
      }
    );
  },

  async listAutomationRules(projectId: string): Promise<AutomationRule[]> {
    return handleQuery(
      async () => {
        const docList = await databases.listDocuments(DB_ID, 'plan_automation_rules', [Query.equal('projectId', projectId)]);
        return docList.documents as unknown as AutomationRule[];
      },
      async () => {
        const db = await readMockDb();
        return db.automationRules.filter(r => r.projectId === projectId);
      }
    );
  },

  async createAutomationRule(projectId: string, input: { trigger: string; conditions?: string; action: string }): Promise<AutomationRule> {
    const newRule: AutomationRule = {
      $id: randomId('rule'),
      projectId,
      trigger: input.trigger,
      conditions: input.conditions || '',
      action: input.action
    };
    return handleQuery(
      async () => {
        const doc = await databases.createDocument(DB_ID, 'plan_automation_rules', ID.unique(), {
          projectId, trigger: newRule.trigger, conditions: newRule.conditions, action: newRule.action
        });
        return doc as unknown as AutomationRule;
      },
      async () => {
        const db = await readMockDb();
        db.automationRules.push(newRule);
        await writeMockDb(db);
        return newRule;
      }
    );
  },

  async deleteAutomationRule(ruleId: string): Promise<boolean> {
    return handleQuery(
      async () => {
        await databases.deleteDocument(DB_ID, 'plan_automation_rules', ruleId);
        return true;
      },
      async () => {
        const db = await readMockDb();
        const idx = db.automationRules.findIndex(r => r.$id === ruleId);
        if (idx === -1) return false;
        db.automationRules.splice(idx, 1);
        await writeMockDb(db);
        return true;
      }
    );
  },

  async listAutomationRuns(projectId: string): Promise<AutomationRun[]> {
    return handleQuery(
      async () => {
        const docList = await databases.listDocuments(DB_ID, 'plan_automation_runs', [
          Query.equal('projectId', projectId),
          Query.orderDesc('createdAt'),
          Query.limit(50),
        ]);
        return docList.documents as unknown as AutomationRun[];
      },
      async () => {
        const db = await readMockDb();
        return db.automationRuns
          .filter(r => r.projectId === projectId)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .slice(0, 50);
      }
    );
  },

  /** Persists an execution record and bumps the rule's runCount/lastRunAt counters (best-effort). */
  async createAutomationRun(run: Omit<AutomationRun, '$id'>): Promise<AutomationRun> {
    const record: AutomationRun = { $id: randomId('run'), ...run };
    return handleQuery(
      async () => {
        const doc = await databases.createDocument(DB_ID, 'plan_automation_runs', ID.unique(), {
          projectId: run.projectId, ruleId: run.ruleId, trigger: run.trigger, action: run.action,
          status: run.status, message: run.message, issueId: run.issueId || '', createdAt: run.createdAt,
        });
        await databases.getDocument(DB_ID, 'plan_automation_rules', run.ruleId)
          .then(rule => databases.updateDocument(DB_ID, 'plan_automation_rules', run.ruleId, {
            runCount: (Number(rule.runCount) || 0) + 1,
            lastRunAt: run.createdAt,
          }))
          .catch(() => { /* counters are best-effort */ });
        return doc as unknown as AutomationRun;
      },
      async () => {
        const db = await readMockDb();
        db.automationRuns.unshift(record);
        db.automationRuns = db.automationRuns.slice(0, 200); // cap history
        const idx = db.automationRules.findIndex(r => r.$id === run.ruleId);
        if (idx !== -1) {
          const rule = db.automationRules[idx];
          db.automationRules[idx] = { ...rule, runCount: (rule.runCount || 0) + 1, lastRunAt: run.createdAt };
        }
        await writeMockDb(db);
        return record;
      }
    );
  },

  async listSprintSnapshots(projectId: string): Promise<SprintSnapshot[]> {
    return handleQuery(
      async () => {
        const docList = await databases.listDocuments(DB_ID, 'plan_sprint_snapshots', [
          Query.equal('projectId', projectId),
          Query.orderAsc('closedAt'),
          Query.limit(100),
        ]);
        return docList.documents as unknown as SprintSnapshot[];
      },
      async () => {
        const db = await readMockDb();
        return db.sprintSnapshots
          .filter(s => s.projectId === projectId)
          .sort((a, b) => a.closedAt.localeCompare(b.closedAt));
      }
    );
  },

  async createSprintSnapshot(snapshot: Omit<SprintSnapshot, '$id'>): Promise<SprintSnapshot> {
    const record: SprintSnapshot = { $id: randomId('snap'), ...snapshot };
    return handleQuery(
      async () => {
        const doc = await databases.createDocument(DB_ID, 'plan_sprint_snapshots', ID.unique(), { ...snapshot });
        return doc as unknown as SprintSnapshot;
      },
      async () => {
        const db = await readMockDb();
        // Replace any prior snapshot for this sprint (re-closing) to avoid dupes.
        db.sprintSnapshots = db.sprintSnapshots.filter(s => s.sprintId !== snapshot.sprintId);
        db.sprintSnapshots.push(record);
        await writeMockDb(db);
        return record;
      }
    );
  },

  async listVulnerabilitiesForUser(userId: string | undefined): Promise<unknown[]> {
    try {
      const repos = await databases.listDocuments(DB_ID, COLLECTIONS.REPOSITORIES, [Query.equal('user_id', userId || '')]);
      const repoIds = repos.documents.map(r => r.$id);
      if (repoIds.length === 0) return [];

      const pageSize = 100;
      const findings: unknown[] = [];
      // Page through results instead of a flat limit(100) - a single page silently
      // dropped every finding past the first 100 for users with larger repo sets.
      // Capped at 20 pages (2000 findings) so a runaway data set can't loop forever.
      for (let page = 0; page < 20; page++) {
        const list = await databases.listDocuments(DB_ID, COLLECTIONS.FINDINGS || 'findings', [
          Query.equal('repo_id', repoIds),
          Query.limit(pageSize),
          Query.offset(page * pageSize)
        ]);
        findings.push(...list.documents);
        if (list.documents.length < pageSize) break;
      }
      return findings;
    } catch {
      return [];
    }
  },

  /**
   * Findings for an explicit set of repositories. Used by requirement
   * correlation to stay project-scoped: it passes only the repos bound to the
   * project, never the owner's whole repo set. Empty input short-circuits to []
   * (an unbound project correlates against nothing, by design).
   */
  async listVulnerabilitiesForRepos(repoIds: string[]): Promise<unknown[]> {
    if (repoIds.length === 0) return [];
    try {
      const pageSize = 100;
      const findings: unknown[] = [];
      for (let page = 0; page < 20; page++) {
        const list = await databases.listDocuments(DB_ID, COLLECTIONS.FINDINGS || 'findings', [
          Query.equal('repo_id', repoIds),
          Query.limit(pageSize),
          Query.offset(page * pageSize),
        ]);
        findings.push(...list.documents);
        if (list.documents.length < pageSize) break;
      }
      return findings;
    } catch {
      return [];
    }
  },

  async listThreats(projectId: string): Promise<Threat[]> {
    return handleQuery(
      async () => {
        const docList = await databases.listDocuments(DB_ID, 'plan_threats', [Query.equal('projectId', projectId)]);
        return docList.documents as unknown as Threat[];
      },
      async () => {
        const db = await readMockDb();
        return (db.threats || []).filter(t => t.projectId === projectId);
      }
    );
  },

  async createThreat(projectId: string, input: { title: string; strideCategory: Threat['strideCategory']; severity: Threat['severity']; description?: string; mitigation?: string }): Promise<Threat> {
    const newThreat: Threat = {
      $id: randomId('threat'),
      projectId,
      title: input.title,
      strideCategory: input.strideCategory,
      severity: input.severity,
      description: input.description || '',
      mitigation: input.mitigation || '',
      status: 'identified'
    };
    return handleQuery(
      async () => {
        const doc = await databases.createDocument(DB_ID, 'plan_threats', ID.unique(), {
          projectId, title: newThreat.title, strideCategory: newThreat.strideCategory,
          severity: newThreat.severity, description: newThreat.description,
          mitigation: newThreat.mitigation, status: newThreat.status
        });
        return doc as unknown as Threat;
      },
      async () => {
        const db = await readMockDb();
        if (!db.threats) db.threats = [];
        db.threats.push(newThreat);
        await writeMockDb(db);
        return newThreat;
      }
    );
  },

  async getThreat(id: string): Promise<Threat | null> {
    return handleQuery(
      async () => {
        const doc = await databases.getDocument(DB_ID, 'plan_threats', id);
        return doc as unknown as Threat;
      },
      async () => {
        const db = await readMockDb();
        return (db.threats || []).find(t => t.$id === id) || null;
      }
    );
  },

  async updateThreat(id: string, updates: Partial<Threat>): Promise<Threat | null> {
    return handleQuery(
      async () => {
        const doc = await databases.updateDocument(DB_ID, 'plan_threats', id, updates);
        return doc as unknown as Threat;
      },
      async () => {
        const db = await readMockDb();
        if (!db.threats) db.threats = [];
        const idx = db.threats.findIndex(t => t.$id === id);
        if (idx === -1) return null;
        db.threats[idx] = { ...db.threats[idx], ...updates };
        await writeMockDb(db);
        return db.threats[idx];
      }
    );
  },

  async deleteThreat(id: string): Promise<boolean> {
    return handleQuery(
      async () => {
        await databases.deleteDocument(DB_ID, 'plan_threats', id);
        return true;
      },
      async () => {
        const db = await readMockDb();
        if (!db.threats) db.threats = [];
        const idx = db.threats.findIndex(t => t.$id === id);
        if (idx === -1) return false;
        db.threats.splice(idx, 1);
        await writeMockDb(db);
        return true;
      }
    );
  }
};
