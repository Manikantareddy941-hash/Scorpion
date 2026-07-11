import type { CorrelationRule } from './securityEvent.types';

const MIN = 60_000;

export const CORRELATION_CATALOG: CorrelationRule[] = [
  {
    id: 'account-takeover', title: 'Probable Account Takeover', severity: 'critical',
    key: 'actor', windowMs: 10 * MIN,
    sequence: [
      { type: 'auth_failure', minCount: 5 },
      { type: 'auth_success', newValueFor: 'srcIp' },
      { type: 'data_export' },
    ],
  },
  {
    id: 'ssrf-metadata-exfil', title: 'SSRF → Cloud Metadata Exfiltration', severity: 'critical',
    key: 'srcIp', windowMs: 5 * MIN,
    sequence: [
      { type: 'metadata_access', targetEquals: '169.254.169.254' },
      { type: 'cloud_api' },
    ],
  },
  {
    id: 'recon-to-exploit', title: 'Recon Followed by Exploit', severity: 'high',
    key: 'srcIp', windowMs: 15 * MIN,
    sequence: [{ type: 'recon' }, { type: 'exploit' }],
  },
  {
    id: 'runtime-breakout', title: 'Container Breakout Attempt', severity: 'critical',
    key: 'target', windowMs: 10 * MIN,
    sequence: [{ type: 'runtime_threat' }, { type: 'outbound_unknown' }],
  },
  {
    id: 'gate-bypass-deploy', title: 'Deploy After Blocked Gate', severity: 'high',
    key: 'target', windowMs: 30 * MIN,
    sequence: [{ type: 'gate_blocked' }, { type: 'deploy' }],
  },
];

export function catalogById(id: string): CorrelationRule | undefined {
  return CORRELATION_CATALOG.find(r => r.id === id);
}
