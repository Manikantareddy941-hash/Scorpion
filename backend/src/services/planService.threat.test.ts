import { buildThreatAcceptanceCriteria, buildThreatIssueFields } from './planService';
import { Threat } from '../types/plan.types';

const threat: Threat = {
  $id: 'threat-1',
  projectId: 'proj-1',
  title: 'Reset token can be intercepted',
  strideCategory: 'Spoofing',
  severity: 'critical',
  description: 'Attacker intercepts the password-reset token and hijacks the account.',
  mitigation: 'Expire token in 15 minutes\nTransmit only over HTTPS\nUse a cryptographically secure token',
  status: 'identified',
};

describe('buildThreatAcceptanceCriteria', () => {
  it('splits a multi-line mitigation into a checkbox list', () => {
    const out = buildThreatAcceptanceCriteria(threat.mitigation);
    expect(out).toBe(
      '- [ ] Expire token in 15 minutes\n- [ ] Transmit only over HTTPS\n- [ ] Use a cryptographically secure token'
    );
  });

  it('strips existing bullet markers so they are not doubled', () => {
    expect(buildThreatAcceptanceCriteria('- already bulleted\n* star bullet')).toBe(
      '- [ ] already bulleted\n- [ ] star bullet'
    );
  });

  it('falls back to a placeholder when there is no mitigation', () => {
    expect(buildThreatAcceptanceCriteria(undefined)).toBe('- [ ] Define and implement a mitigation');
    expect(buildThreatAcceptanceCriteria('   ')).toBe('- [ ] Define and implement a mitigation');
  });
});

describe('buildThreatIssueFields', () => {
  it('produces a security story with priority mapped from severity', () => {
    const issue = buildThreatIssueFields(threat, 'proj-1');
    expect(issue.type).toBe('story');
    expect(issue.priority).toBe('critical');
    expect(issue.projectId).toBe('proj-1');
    expect(issue.title).toBe('[Threat] Reset token can be intercepted');
  });

  it('tags the issue for traceability back to the STRIDE category', () => {
    const issue = buildThreatIssueFields(threat, 'proj-1');
    expect(issue.labels).toEqual(['security', 'threat-model', 'stride:Spoofing']);
  });

  it('embeds STRIDE, severity, and the acceptance-criteria checklist in the description', () => {
    const issue = buildThreatIssueFields(threat, 'proj-1');
    expect(issue.description).toContain('**STRIDE:** Spoofing');
    expect(issue.description).toContain('**Severity:** critical');
    expect(issue.description).toContain('**Acceptance criteria (mitigations):**');
    expect(issue.description).toContain('- [ ] Expire token in 15 minutes');
  });
});
