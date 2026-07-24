// Types for the Plan-phase Security Requirements Engine (feature 2a).
// See docs/superpowers/specs/2026-07-24-security-requirements-engine-design.md

export type AppType = 'web' | 'api' | 'mobile' | 'service';
export type Stack = 'node' | 'python' | 'java' | 'go' | 'dotnet' | 'ruby';
export type DataType = 'card' | 'health' | 'pii' | 'none';
export type Deployment = 'cloud' | 'on-prem' | 'hybrid';
export type AuthModel = 'none' | 'session' | 'oauth' | 'mtls';
export type Framework = 'PCI DSS' | 'NIST 800-53' | 'SOC 2' | 'ISO 27001' | 'HIPAA' | 'GDPR';

export type Severity = 'low' | 'medium' | 'high' | 'critical';
export type RequirementStatus = 'required' | 'recommended';
export type LifecycleStatus = 'open' | 'satisfied' | 'waived' | 'obsolete';

/** The six-dimension project profile the rules match against. */
export interface ProjectProfile {
  projectId: string;
  appType: AppType;
  stack: Stack[];
  dataTypes: DataType[];
  deployment: Deployment;
  authModel: AuthModel;
  frameworks: Framework[];
  updatedAt?: string;
}

/** What a single rule emits: one control, so framework/controlId are singular. */
export interface EmittedRequirement {
  code: string;
  title: string;
  description: string;
  category: string;
  framework: Framework;
  controlId: string;
  severity: Severity;
  status: RequirementStatus;
  remediation: string;
}

/** A rule: a predicate over the profile plus the requirements it emits. */
export interface RequirementRule {
  id: string;
  when: (profile: ProjectProfile) => boolean;
  emit: EmittedRequirement[];
}

/**
 * A requirement after generation: the same code emitted by multiple rules is
 * merged, so framework/controlId/sourceRuleId become arrays.
 */
export interface GeneratedRequirement {
  code: string;
  title: string;
  description: string;
  category: string;
  frameworks: Framework[];
  controlIds: string[];
  severity: Severity;
  status: RequirementStatus;
  remediation: string;
  sourceRuleId: string[];
}

/** A generated requirement plus its persisted lifecycle + audit fields. */
export interface StoredRequirement extends GeneratedRequirement {
  $id?: string;
  projectId: string;
  lifecycleStatus: LifecycleStatus;
  justification?: string;
  updatedBy?: string;
  createdAt: string;
}

/** The plan produced by reconcile(): what to persist against the current state. */
export interface ReconcilePlan {
  toCreate: GeneratedRequirement[];
  toUpdate: { stored: StoredRequirement; generated: GeneratedRequirement }[];
  toObsolete: StoredRequirement[];
}
