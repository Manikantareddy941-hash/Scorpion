import { matchPlaybooks, normalizePriority, Playbook, MatchedAction } from './playbookMatcher';

const pb = (over: Partial<Playbook> = {}): Playbook => ({
  id: 'pb-1',
  name: 'Shell response',
  enabled: true,
  trigger: { rulePattern: 'Terminal shell*', minPriority: 'Warning' },
  actions: [
    { type: 'capture_evidence', mode: 'auto' },
    { type: 'isolate_pod', mode: 'auto' },
    { type: 'kill_pod', mode: 'approval' },
  ],
  ...over,
});

describe('matchPlaybooks', () => {
  it('matches rule prefix pattern and min priority', () => {
    const out = matchPlaybooks({ rule: 'Terminal shell in container', priority: 'Critical' }, [pb()]);
    expect(out).toHaveLength(3);
  });

  it('skips disabled playbooks', () => {
    expect(matchPlaybooks({ rule: 'Terminal shell in container', priority: 'Critical' }, [pb({ enabled: false })])).toEqual([]);
  });

  it('skips when priority below minPriority', () => {
    expect(matchPlaybooks({ rule: 'Terminal shell in container', priority: 'Notice' }, [pb()])).toEqual([]);
  });

  it('exact match when pattern has no wildcard', () => {
    const p = pb({ trigger: { rulePattern: 'Write below etc', minPriority: 'Warning' } });
    expect(matchPlaybooks({ rule: 'Write below etc', priority: 'Error' }, [p])).toHaveLength(3);
    expect(matchPlaybooks({ rule: 'Write below etc dir', priority: 'Error' }, [p])).toEqual([]);
  });

  it('missing rulePattern matches every rule', () => {
    const p = pb({ trigger: { minPriority: 'Critical' } });
    expect(matchPlaybooks({ rule: 'Anything', priority: 'Critical' }, [p])).toHaveLength(3);
  });

  it('non-destructive auto actions always execute auto', () => {
    const out = matchPlaybooks({ rule: 'Terminal shell x', priority: 'Warning' }, [pb()]);
    const a = out.find((action: MatchedAction) => action.type === 'capture_evidence');
    expect(a?.execution).toBe('auto');
  });

  it('destructive auto action downgrades to approval below Critical', () => {
    const out = matchPlaybooks({ rule: 'Terminal shell x', priority: 'Warning' }, [pb()]);
    const a = out.find((action: MatchedAction) => action.type === 'isolate_pod');
    expect(a?.execution).toBe('approval');
  });

  it('destructive auto action stays auto at Critical and above', () => {
    const out = matchPlaybooks({ rule: 'Terminal shell x', priority: 'Alert' }, [pb()]);
    const a = out.find((action: MatchedAction) => action.type === 'isolate_pod');
    expect(a?.execution).toBe('auto');
  });

  it('destructive approval action never auto-executes', () => {
    const out = matchPlaybooks({ rule: 'Terminal shell x', priority: 'Emergency' }, [pb()]);
    const a = out.find((action: MatchedAction) => action.type === 'kill_pod');
    expect(a?.execution).toBe('approval');
  });
});

describe('normalizePriority', () => {
  it('passes known priorities through', () => expect(normalizePriority('Critical')).toBe('Critical'));
  it('is case-insensitive', () => expect(normalizePriority('critical')).toBe('Critical'));
  it('defaults unknown to Notice', () => expect(normalizePriority('weird')).toBe('Notice'));
});
