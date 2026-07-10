import type { FalcoPriority } from '../soar/playbookMatcher';

/**
 * Fixed Falco rule template catalog + pure YAML renderer + ingestion
 * classifier. Scorpion never pushes rules to the cluster; the rendered YAML is
 * exported for ConfigMap sync. Unknown rules are never suppressed (fail-open
 * on detection, fail-closed on silence).
 */

export type FalcoTemplateId =
  | 'terminal-shell-in-container'
  | 'outbound-unknown-domain'
  | 'write-below-etc'
  | 'sensitive-file-read'
  | 'spawn-package-manager';

export interface ManagedFalcoRule {
  id: string;
  template: FalcoTemplateId;
  params: { allowedProcs?: string[]; allowedDomains?: string[]; watchedPaths?: string[] };
  /** Container image prefix this rule applies to; empty/undefined = global. */
  appScope?: string;
  severityOverride?: FalcoPriority;
  suppressed: boolean;
  enabled: boolean;
}

interface TemplateDef {
  falcoRuleName: string;
  description: string;
  priority: FalcoPriority;
  baseCondition: string;
  output: string;
}

export const FALCO_TEMPLATES: Record<FalcoTemplateId, TemplateDef> = {
  'terminal-shell-in-container': {
    falcoRuleName: 'Terminal shell in container',
    description: 'Interactive shell spawned inside a running container.',
    priority: 'Critical',
    baseCondition: 'spawned_process and container and shell_procs and proc.tty != 0',
    output: 'Shell in container (user=%user.name container=%container.id image=%container.image.repository cmdline=%proc.cmdline)',
  },
  'outbound-unknown-domain': {
    falcoRuleName: 'Unexpected outbound connection destination',
    description: 'Outbound network connection to a destination outside the allowlist.',
    priority: 'Warning',
    baseCondition: 'outbound and container',
    output: 'Unexpected outbound connection (container=%container.id image=%container.image.repository connection=%fd.name)',
  },
  'write-below-etc': {
    falcoRuleName: 'Write below etc',
    description: 'File write under /etc inside a container.',
    priority: 'Error',
    baseCondition: "open_write and container and fd.name startswith /etc",
    output: 'Write below /etc (file=%fd.name container=%container.id image=%container.image.repository)',
  },
  'sensitive-file-read': {
    falcoRuleName: 'Read sensitive file untrusted',
    description: 'Read of shadow/ssh/cloud-credential files by a non-trusted program.',
    priority: 'Critical',
    baseCondition: 'open_read and container and sensitive_files',
    output: 'Sensitive file read (file=%fd.name container=%container.id image=%container.image.repository proc=%proc.name)',
  },
  'spawn-package-manager': {
    falcoRuleName: 'Launch package management process in container',
    description: 'apt/yum/apk/pip executed inside a running container.',
    priority: 'Error',
    baseCondition: 'spawned_process and container and proc.name in (apt, apt-get, yum, dnf, apk, pip, pip3)',
    output: 'Package manager launched (proc=%proc.name container=%container.id image=%container.image.repository cmdline=%proc.cmdline)',
  },
};

// Conservative whitelist for values interpolated into conditions. Anything
// else (colons, parens, newlines, quotes) could break YAML/condition parsing
// for the WHOLE rules file, silently disabling every rule. Dropping a bad
// allowlist entry is the fail-secure direction: it means MORE alerting.
export const SAFE_PARAM = /^[A-Za-z0-9_./-]+$/;

const safeValues = (values: string[] | undefined): string[] =>
  (values ?? []).filter((v) => SAFE_PARAM.test(v));

function conditionFor(rule: ManagedFalcoRule, def: TemplateDef): string {
  const parts = [def.baseCondition];
  const procs = safeValues(rule.params.allowedProcs);
  if (procs.length) {
    parts.push(`and not proc.name in (${procs.join(', ')})`);
  }
  const domains = safeValues(rule.params.allowedDomains);
  if (rule.template === 'outbound-unknown-domain' && domains.length) {
    parts.push(`and not fd.sip.name in (${domains.join(', ')})`);
  }
  const paths = safeValues(rule.params.watchedPaths);
  if (rule.template === 'write-below-etc' && paths.length) {
    const extra = paths.map((p) => `fd.name startswith ${p}`).join(' or ');
    parts.push(`or (open_write and container and (${extra}))`);
  }
  return parts.join(' ');
}

export function renderFalcoRules(rules: ManagedFalcoRule[]): string {
  const header = '# Scorpion-managed Falco rules — generated, do not edit by hand.\n';
  const blocks = rules
    .filter((r) => r.enabled && !r.suppressed)
    .map((r) => {
      const def = FALCO_TEMPLATES[r.template];
      const priority = r.severityOverride ?? def.priority;
      return [
        `- rule: ${def.falcoRuleName}`,
        `  desc: ${def.description}`,
        `  condition: ${conditionFor(r, def)}`,
        `  output: >`,
        `    ${def.output}`,
        `  priority: ${priority.toUpperCase()}`,
        `  tags: [scorpion_managed, runtime_defense]`,
      ].join('\n');
    });
  return header + blocks.join('\n\n') + (blocks.length ? '\n' : '');
}

export function classifyEvent(
  event: { rule: string; containerImage: string },
  rules: ManagedFalcoRule[],
): { suppressed: boolean; overridePriority?: FalcoPriority } {
  const candidates = rules.filter((r) => {
    if (!r.enabled) return false;
    const def = FALCO_TEMPLATES[r.template];
    if (def.falcoRuleName.toLowerCase() !== event.rule.toLowerCase()) return false;
    if (r.appScope && !event.containerImage.startsWith(r.appScope)) return false;
    return true;
  });
  // Most specific wins: a scoped match beats a global one, regardless of
  // array order. ponytail: two tiers only; longest-prefix-wins if scopes nest.
  const match = candidates.find((r) => r.appScope) ?? candidates[0];
  if (!match) return { suppressed: false };
  return { suppressed: match.suppressed, overridePriority: match.severityOverride };
}
