/**
 * Pure SOAR decision core: which playbook actions fire for a Falco event, and
 * whether each runs automatically or waits for human approval. Zero I/O.
 *
 * Tier rule (fail-secure): destructive actions auto-execute only when the
 * playbook explicitly opts in (mode 'auto') AND the event is Critical+.
 */

export type FalcoPriority =
  | 'Emergency' | 'Alert' | 'Critical' | 'Error'
  | 'Warning' | 'Notice' | 'Informational' | 'Debug';

export type SoarActionType = 'capture_evidence' | 'slack_escalate' | 'isolate_pod' | 'kill_pod';
export type SoarActionMode = 'auto' | 'approval';

export interface PlaybookAction { type: SoarActionType; mode: SoarActionMode }

export interface Playbook {
  id: string;
  name: string;
  enabled: boolean;
  trigger: { rulePattern?: string; minPriority: FalcoPriority };
  actions: PlaybookAction[];
}

export interface MatchedAction {
  playbookId: string;
  playbookName: string;
  type: SoarActionType;
  execution: 'auto' | 'approval';
}

export const PRIORITY_RANK: Record<FalcoPriority, number> = {
  Emergency: 8, Alert: 7, Critical: 6, Error: 5,
  Warning: 4, Notice: 3, Informational: 2, Debug: 1,
};

export const DESTRUCTIVE_ACTIONS: ReadonlySet<SoarActionType> = new Set(['isolate_pod', 'kill_pod']);

const PRIORITIES = Object.keys(PRIORITY_RANK) as FalcoPriority[];

export function normalizePriority(raw: string): FalcoPriority {
  return PRIORITIES.find((p) => p.toLowerCase() === raw.toLowerCase()) ?? 'Notice';
}

function ruleMatches(rule: string, pattern?: string): boolean {
  if (!pattern) return true;
  const r = rule.toLowerCase();
  const p = pattern.toLowerCase();
  return p.endsWith('*') ? r.startsWith(p.slice(0, -1)) : r === p;
}

function resolveExecution(action: PlaybookAction, priority: FalcoPriority): 'auto' | 'approval' {
  if (!DESTRUCTIVE_ACTIONS.has(action.type)) return action.mode === 'auto' ? 'auto' : 'approval';
  const criticalPlus = PRIORITY_RANK[priority] >= PRIORITY_RANK.Critical;
  return action.mode === 'auto' && criticalPlus ? 'auto' : 'approval';
}

export function matchPlaybooks(
  event: { rule: string; priority: FalcoPriority },
  playbooks: Playbook[],
): MatchedAction[] {
  return playbooks
    .filter((p) => p.enabled)
    .filter((p) => PRIORITY_RANK[event.priority] >= PRIORITY_RANK[p.trigger.minPriority])
    .filter((p) => ruleMatches(event.rule, p.trigger.rulePattern))
    .flatMap((p) =>
      p.actions.map((a) => ({
        playbookId: p.id,
        playbookName: p.name,
        type: a.type,
        execution: resolveExecution(a, event.priority),
      })),
    );
}
