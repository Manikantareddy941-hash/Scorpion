export type SecurityEventType =
  | 'auth_failure' | 'auth_success' | 'data_export' | 'metadata_access'
  | 'cloud_api' | 'recon' | 'exploit' | 'runtime_threat'
  | 'outbound_unknown' | 'gate_blocked' | 'deploy' | 'status_spike';

export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export interface SecurityEvent {
  id: string;
  type: SecurityEventType;
  actor?: string;
  srcIp?: string;
  repoId?: string;
  ownerUserId: string;
  target?: string;
  severity: Severity;
  timestamp: number; // epoch ms
  metadata?: Record<string, string | number | boolean>;
}

export interface RuleCondition {
  type: SecurityEventType;
  minCount?: number;         // default 1
  newValueFor?: 'srcIp';     // condition matches only when this field differs from the prior matched event's value (e.g. login from a new IP)
  targetEquals?: string;     // literal target the event must carry (e.g. '169.254.169.254')
}

export interface CorrelationRule {
  id: string;
  title: string;
  severity: Severity;
  key: 'srcIp' | 'actor' | 'target';
  windowMs: number;
  sequence: RuleCondition[];
}

export type RuleState = { id: string; enabled: boolean; severityOverride?: Severity };

export interface Correlation {
  ruleId: string;
  title: string;
  severity: Severity;
  correlationKey: string;    // the shared key value (ip/actor/target)
  bucket: number;            // earliest matched event timestamp, floored to windowMs — idempotency anchor
  matchedEventIds: string[];
  ownerUserId: string;
}
