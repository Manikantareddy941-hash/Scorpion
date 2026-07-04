import { renderFalcoRules, classifyEvent, ManagedFalcoRule } from './falcoRuleCatalog';

const rule = (over: Partial<ManagedFalcoRule> = {}): ManagedFalcoRule => ({
  id: 'r-1',
  template: 'terminal-shell-in-container',
  params: {},
  suppressed: false,
  enabled: true,
  ...over,
});

describe('renderFalcoRules', () => {
  it('renders an enabled rule as Falco YAML', () => {
    const yaml = renderFalcoRules([rule()]);
    expect(yaml).toContain('- rule: Terminal shell in container');
    expect(yaml).toContain('condition:');
    expect(yaml).toContain('priority:');
  });

  it('excludes suppressed and disabled rules', () => {
    expect(renderFalcoRules([rule({ suppressed: true })])).not.toContain('- rule:');
    expect(renderFalcoRules([rule({ enabled: false })])).not.toContain('- rule:');
  });

  it('folds allowedProcs into the condition as exceptions', () => {
    const yaml = renderFalcoRules([rule({ params: { allowedProcs: ['tini', 'dumb-init'] } })]);
    expect(yaml).toContain('and not proc.name in (tini, dumb-init)');
  });

  it('renders outbound-unknown-domain with allowedDomains', () => {
    const yaml = renderFalcoRules([rule({
      template: 'outbound-unknown-domain',
      params: { allowedDomains: ['api.internal', 'sts.amazonaws.com'] },
    })]);
    expect(yaml).toContain('- rule: Unexpected outbound connection destination');
    expect(yaml).toContain('api.internal');
  });

  it('renders an empty rules header when nothing is enabled', () => {
    expect(renderFalcoRules([])).toContain('# Scorpion-managed Falco rules');
  });
});

describe('classifyEvent', () => {
  it('suppresses a matching suppressed rule', () => {
    const out = classifyEvent(
      { rule: 'Terminal shell in container', containerImage: 'reg/app' },
      [rule({ suppressed: true })],
    );
    expect(out.suppressed).toBe(true);
  });

  it('respects appScope image prefix', () => {
    const scoped = rule({ suppressed: true, appScope: 'reg/batch-' });
    expect(classifyEvent({ rule: 'Terminal shell in container', containerImage: 'reg/batch-job' }, [scoped]).suppressed).toBe(true);
    expect(classifyEvent({ rule: 'Terminal shell in container', containerImage: 'reg/web' }, [scoped]).suppressed).toBe(false);
  });

  it('returns severity override for a matching rule', () => {
    const out = classifyEvent(
      { rule: 'Terminal shell in container', containerImage: 'reg/app' },
      [rule({ severityOverride: 'Critical' })],
    );
    expect(out.overridePriority).toBe('Critical');
  });

  it('never suppresses unknown rules', () => {
    expect(classifyEvent({ rule: 'Some brand new rule', containerImage: 'x' }, [rule({ suppressed: true })]).suppressed).toBe(false);
  });

  it('disabled rules do not classify', () => {
    const out = classifyEvent(
      { rule: 'Terminal shell in container', containerImage: 'reg/app' },
      [rule({ suppressed: true, enabled: false })],
    );
    expect(out.suppressed).toBe(false);
  });
});
