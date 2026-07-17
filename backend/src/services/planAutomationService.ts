import { randomUUID } from 'crypto';
import { planRepository } from '../repositories/planRepository';
import { AutomationRule, Issue, Sprint } from '../types/plan.types';
import { sendSecurityAlert } from './notificationService';
import { logger } from './logger';

/**
 * Automation engine for the Plan module. Executes stored automation rules when
 * issue/sprint lifecycle events happen and records every execution as an
 * AutomationRun so the UI can show real "last fired" history.
 *
 * Every entry point swallows its own errors: automation must never break the
 * user action that triggered it.
 */

const AUTOMATION_TRIGGER_LABELS: Record<string, string> = {
  critical_vuln: 'Critical Issue Created',
  vuln_resolved: 'Issue Resolved',
  sprint_ended: 'Sprint Concluded',
};

export interface AutomationContext {
  issue?: Issue;
  sprint?: Sprint;
  userEmail?: string;
}

// Creates a follow-up task issue in the same project (the auto_create_task action).
async function createFollowUpTask(projectId: string, title: string, description: string): Promise<string | undefined> {
  const issue: Issue = {
    $id: `issue-${randomUUID()}`,
    projectId, epicId: null, sprintId: null, type: 'task', title,
    description, priority: 'high', status: 'todo', assignee: 'dev@scorpion.local',
    storyPoints: 0, timeEstimate: 0, timeLogged: 0, vulnId: null,
    labels: ['automation'], createdAt: new Date().toISOString(),
  };
  const created = await planRepository.createIssue(issue);
  return created?.$id;
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
      const moved = await rollUnfinishedToBacklog(ctx.sprint.$id);
      return `Rolled ${moved} unfinished issue(s) back to the backlog`;
    }
    default:
      return `Unknown action "${rule.action}" — no-op`;
  }
}

/** Runs every enabled rule whose trigger matches `event` for this project. */
export async function runAutomation(projectId: string, event: string, ctx: AutomationContext): Promise<void> {
  try {
    const rules = await planRepository.listAutomationRules(projectId);
    const matching = rules.filter(r => r.trigger === event && r.enabled !== false);
    for (const rule of matching) {
      const now = new Date().toISOString();
      try {
        const message = await executeRuleAction(projectId, rule, ctx);
        await planRepository.createAutomationRun({
          projectId, ruleId: rule.$id, trigger: rule.trigger, action: rule.action,
          status: 'success', message, issueId: ctx.issue?.$id, createdAt: now,
        });
        logger.info(`[Automation] Rule ${rule.$id} (${rule.trigger}→${rule.action}) fired: ${message}`);
      } catch (actionErr) {
        const message = actionErr instanceof Error ? actionErr.message : 'Action failed';
        await planRepository.createAutomationRun({
          projectId, ruleId: rule.$id, trigger: rule.trigger, action: rule.action,
          status: 'error', message, issueId: ctx.issue?.$id, createdAt: now,
        }).catch(() => { /* run history is best-effort */ });
        logger.error(`[Automation] Rule ${rule.$id} action failed:`, message);
      }
    }
  } catch (err) {
    logger.error('[Automation] Engine failure:', err instanceof Error ? err.message : err);
  }
}

/**
 * Snapshots a sprint's committed-vs-completed story points at the moment it's
 * closed, so velocity charts have real history even after issues roll off into
 * later sprints. `sprintIssues` must be read BEFORE unfinished issues are moved
 * out (the caller pre-reads them ahead of the status update).
 */
export async function writeSprintSnapshot(projectId: string, sprint: Sprint, sprintIssues: Issue[]): Promise<void> {
  try {
    const committedPoints = sprintIssues.reduce((acc, i) => acc + (Number(i.storyPoints) || 0), 0);
    const done = sprintIssues.filter(i => i.status === 'done');
    await planRepository.createSprintSnapshot({
      projectId,
      sprintId: sprint.$id,
      sprintName: sprint.name,
      committedPoints,
      completedPoints: done.reduce((acc, i) => acc + (Number(i.storyPoints) || 0), 0),
      committedIssues: sprintIssues.length,
      completedIssues: done.length,
      startDate: sprint.startDate,
      endDate: sprint.endDate,
      closedAt: new Date().toISOString(),
    });
  } catch (err) {
    logger.error('[SprintSnapshot] Failed to snapshot sprint velocity:', err instanceof Error ? err.message : err);
  }
}

/**
 * Guaranteed roll-to-backlog of unfinished issues on sprint close (core Scrum
 * behaviour, independent of automation rules). Idempotent across both stores —
 * the mock store also rolls inside updateSprint, so a second pass is a no-op.
 * Returns the number of issues moved.
 */
export async function rollUnfinishedToBacklog(sprintId: string): Promise<number> {
  let moved = 0;
  try {
    const open = await planRepository.listIssuesBySprint(sprintId);
    for (const issue of open) {
      if (issue.status !== 'done') {
        await planRepository.updateIssue(issue.$id, { sprintId: null });
        moved++;
      }
    }
  } catch (err) {
    logger.error('[Sprint] Failed to roll unfinished issues to backlog:', err instanceof Error ? err.message : err);
  }
  return moved;
}
