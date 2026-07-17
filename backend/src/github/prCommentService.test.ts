import {
  formatPrComment,
  upsertPrComment,
  PR_COMMENT_MARKER,
  PrCommentClient
} from './prCommentService';

const trivyFixture = {
  Results: [
    {
      Target: 'package-lock.json',
      Vulnerabilities: [
        {
          VulnerabilityID: 'CVE-2024-1234',
          Severity: 'CRITICAL',
          PkgName: 'lodash',
          InstalledVersion: '4.17.20',
          FixedVersion: '4.17.21',
          Title: 'Prototype pollution'
        },
        {
          VulnerabilityID: 'CVE-2024-5678',
          Severity: 'HIGH',
          PkgName: 'express',
          InstalledVersion: '4.18.0',
          Title: 'Open redirect'
        }
      ]
    }
  ]
};

const semgrepFixture = {
  results: [
    {
      check_id: 'javascript.express.security.audit.xss',
      path: 'src/app.ts',
      start: { line: 42 },
      extra: { severity: 'ERROR', message: 'Possible XSS' }
    }
  ]
};

const gitleaksFixture = [
  {
    RuleID: 'aws-access-key-id',
    File: 'src/config.ts',
    StartLine: 7,
    Description: 'AWS Access Key ID'
  }
];

const blockedGate = {
  passed: false,
  criticalCount: 1,
  highCount: 1,
  secretCount: 1,
  sastCount: 1,
  summary: 'Policy violated',
  denyReasons: ['1 critical finding(s) — blocked by repo policy (blockOnCritical)']
};

const passedGate = {
  passed: true,
  criticalCount: 0,
  highCount: 0,
  secretCount: 0,
  sastCount: 0,
  summary: 'Clean — 0 critical, 0 high, 0 secrets',
  denyReasons: []
};

describe('formatPrComment', () => {
  it('renders a blocked report with marker, verdict, deny reasons and findings', () => {
    const body = formatPrComment(
      { trivy: trivyFixture, semgrep: semgrepFixture, gitleaks: gitleaksFixture },
      blockedGate,
      'https://scorpion.example.com/scans/abc'
    );

    expect(body.startsWith(PR_COMMENT_MARKER)).toBe(true);
    expect(body).toContain('❌');
    expect(body).toContain('blocked by repo policy');
    expect(body).toContain('CVE-2024-1234');
    expect(body).toContain('aws-access-key-id');
    expect(body).toContain('src/config.ts:7');
    expect(body).toContain('javascript.express.security.audit.xss');
    expect(body).toContain('src/app.ts:42');
    expect(body).toContain('https://scorpion.example.com/scans/abc');
  });

  it('renders a passed report', () => {
    const body = formatPrComment(
      { trivy: {}, semgrep: { results: [] }, gitleaks: [] },
      passedGate
    );

    expect(body).toContain('✅');
    expect(body).toContain('No findings');
  });

  it('shows top 10 findings and collapses the remainder', () => {
    const vulns = Array.from({ length: 70 }, (_, i) => ({
      VulnerabilityID: `CVE-2024-${1000 + i}`,
      Severity: i < 5 ? 'CRITICAL' : 'MEDIUM',
      PkgName: `pkg-${i}`,
      InstalledVersion: '1.0.0',
      Title: `Vuln ${i}`
    }));
    const body = formatPrComment(
      {
        trivy: { Results: [{ Target: 'package-lock.json', Vulnerabilities: vulns }] },
        semgrep: { results: [] },
        gitleaks: []
      },
      { ...blockedGate, criticalCount: 5, highCount: 0, secretCount: 0 }
    );

    // critical findings sort to the top table
    expect(body).toContain('CVE-2024-1000');
    // remainder lives in a collapsible section, capped at 50 rows
    expect(body).toContain('<details>');
    expect(body).toContain('+10 more');
  });

  it('stays under the GitHub comment size limit', () => {
    const vulns = Array.from({ length: 500 }, (_, i) => ({
      VulnerabilityID: `CVE-2024-${i}`,
      Severity: 'HIGH',
      PkgName: 'p'.repeat(200),
      InstalledVersion: '1.0.0',
      Title: 'T'.repeat(500)
    }));
    const body = formatPrComment(
      {
        trivy: { Results: [{ Target: 't', Vulnerabilities: vulns }] },
        semgrep: { results: [] },
        gitleaks: []
      },
      blockedGate
    );

    expect(body.length).toBeLessThan(65536);
  });
});

describe('upsertPrComment', () => {
  const params = { owner: 'acme', repo: 'shop', prNumber: 12, body: `${PR_COMMENT_MARKER}\nnew` };

  function mockClient(existing: Array<{ id: number; body?: string }>): PrCommentClient {
    return {
      issues: {
        listComments: jest.fn().mockResolvedValue({ data: existing }),
        updateComment: jest.fn().mockResolvedValue({}),
        createComment: jest.fn().mockResolvedValue({})
      }
    };
  }

  it('updates the existing marker comment in place', async () => {
    const client = mockClient([
      { id: 5, body: 'unrelated comment' },
      { id: 9, body: `${PR_COMMENT_MARKER}\nold report` }
    ]);

    await upsertPrComment(client, params);

    expect(client.issues.updateComment).toHaveBeenCalledWith(
      expect.objectContaining({ comment_id: 9, body: params.body })
    );
    expect(client.issues.createComment).not.toHaveBeenCalled();
  });

  it('creates a new comment when none exists', async () => {
    const client = mockClient([{ id: 5, body: 'unrelated' }]);

    await upsertPrComment(client, params);

    expect(client.issues.createComment).toHaveBeenCalledWith(
      expect.objectContaining({ issue_number: 12, body: params.body })
    );
    expect(client.issues.updateComment).not.toHaveBeenCalled();
  });
});
