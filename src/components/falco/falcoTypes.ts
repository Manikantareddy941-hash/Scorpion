export type FalcoTemplateId =
  | 'terminal-shell-in-container' | 'outbound-unknown-domain' | 'write-below-etc'
  | 'sensitive-file-read' | 'spawn-package-manager';
export type FalcoPriority =
  | 'Emergency' | 'Alert' | 'Critical' | 'Error'
  | 'Warning' | 'Notice' | 'Informational' | 'Debug';

export interface TemplateDef { falcoRuleName: string; description: string; priority: FalcoPriority }
export interface ManagedFalcoRule {
  id: string;
  template: FalcoTemplateId;
  params: { allowedProcs?: string[]; allowedDomains?: string[]; watchedPaths?: string[] };
  appScope?: string;
  severityOverride?: FalcoPriority;
  suppressed: boolean;
  enabled: boolean;
}

export interface RowState {
  id?: string;
  appScope: string;
  severityOverride: FalcoPriority | '';
  suppressed: boolean;
  enabled: boolean;
  allowedProcs: string;
  allowedDomains: string;
  watchedPaths: string;
}

export const PRIORITIES: FalcoPriority[] = ['Emergency', 'Alert', 'Critical', 'Error', 'Warning', 'Notice', 'Informational', 'Debug'];

export const INPUT_CLS =
  'w-full bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-xl px-3 py-2 text-xs text-[var(--text-primary)] outline-none';
export const LABEL_CLS = 'block text-[9px] font-black uppercase italic text-[var(--text-secondary)] mb-1';

export const csvToArray = (text: string): string[] => text.split(',').map((s) => s.trim()).filter(Boolean);

export const emptyRow = (): RowState => ({
  appScope: '', severityOverride: '', suppressed: false, enabled: true,
  allowedProcs: '', allowedDomains: '', watchedPaths: '',
});

export function rowFromRule(rule: ManagedFalcoRule): RowState {
  return {
    id: rule.id,
    appScope: rule.appScope || '',
    severityOverride: rule.severityOverride || '',
    suppressed: rule.suppressed,
    enabled: rule.enabled,
    allowedProcs: (rule.params.allowedProcs || []).join(', '),
    allowedDomains: (rule.params.allowedDomains || []).join(', '),
    watchedPaths: (rule.params.watchedPaths || []).join(', '),
  };
}
