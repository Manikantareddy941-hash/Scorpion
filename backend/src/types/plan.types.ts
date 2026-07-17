import { Models } from 'node-appwrite';
import { Request } from 'express';

export interface AuthenticatedRequest extends Request<Record<string, string>> {
  user?: Models.User<Models.Preferences> & { $id: string };
}

export interface Project {
  $id: string;
  name: string;
  repoId: string;
  type: 'kanban' | 'scrum';
  createdAt: string;
  user_id?: string;
}

export interface Epic {
  $id: string;
  projectId: string;
  title: string;
  color: string;
  startDate?: string;
  endDate?: string;
  status: string;
}

export interface Sprint {
  $id: string;
  projectId: string;
  name: string;
  goal?: string;
  startDate?: string;
  endDate?: string;
  status: 'planned' | 'active' | 'completed';
}

export interface Issue {
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

export interface Comment {
  $id: string;
  issueId: string;
  author: string;
  body: string;
  createdAt: string;
}

export interface AutomationRule {
  $id: string;
  projectId: string;
  trigger: string;
  conditions?: string;
  action: string;
  enabled?: boolean;
  runCount?: number;
  lastRunAt?: string | null;
}

export interface AutomationRun {
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

export interface SprintSnapshot {
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

export interface Worklog {
  $id: string;
  issueId: string;
  author: string;
  minutes: number;
  comment?: string;
  createdAt: string;
}

export interface Threat {
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

export interface PlanSchema {
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
