export type SoarActionType = 'capture_evidence' | 'slack_escalate' | 'isolate_pod' | 'kill_pod';
export type SoarActionMode = 'auto' | 'approval';
export type SoarActionStatus = 'pending' | 'approved' | 'rejected' | 'executed' | 'failed';
export type FalcoPriority =
  | 'Emergency' | 'Alert' | 'Critical' | 'Error'
  | 'Warning' | 'Notice' | 'Informational' | 'Debug';

export interface PlaybookAction { type: SoarActionType; mode: SoarActionMode }
export interface Playbook {
  id: string;
  name: string;
  enabled: boolean;
  trigger: { rulePattern?: string; minPriority: FalcoPriority };
  actions: PlaybookAction[];
}
export interface SoarActionRecord {
  id: string;
  actionType: SoarActionType;
  playbookName: string;
  status: SoarActionStatus;
  namespace?: string;
  podName?: string;
  falcoRule: string;
  createdAt: string;
}

export const PRIORITIES: FalcoPriority[] = ['Emergency', 'Alert', 'Critical', 'Error', 'Warning', 'Notice', 'Informational', 'Debug'];
export const ACTION_TYPES: SoarActionType[] = ['capture_evidence', 'slack_escalate', 'isolate_pod', 'kill_pod'];
export const DESTRUCTIVE = new Set<SoarActionType>(['isolate_pod', 'kill_pod']);

export const INPUT_CLS =
  'w-full bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-xl px-3 py-2 text-xs text-[var(--text-primary)] outline-none';
export const LABEL_CLS = 'block text-[9px] font-black uppercase italic text-[var(--text-secondary)] mb-1';
