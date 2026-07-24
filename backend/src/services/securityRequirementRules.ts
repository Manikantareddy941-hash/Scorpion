import { ProjectProfile, RequirementRule } from '../types/securityRequirements.types';

// Curated, versioned security-requirement library (Plan-phase feature 2a).
//
// Each rule gates on the profile (including which frameworks the team selected)
// and emits one or more requirements, every one traceable to a real control.
// A rule owns a single control, so it emits a singular framework/controlId; the
// engine merges the same `code` across rules into framework/control arrays.
//
// Accuracy over breadth: this is a real starter set, not an exhaustive content
// library. Extend by adding rules — the integrity test guards consistency.

const fw = (p: ProjectProfile, f: ProjectProfile['frameworks'][number]): boolean => p.frameworks.includes(f);
const data = (p: ProjectProfile, d: ProjectProfile['dataTypes'][number]): boolean => p.dataTypes.includes(d);

// Shared MFA requirement text — emitted by several frameworks and merged by the
// engine. Title/category/description MUST match across emitters (integrity test).
const MFA = {
  code: 'REQ-AUTH-MFA',
  title: 'Enforce multi-factor authentication',
  description:
    'All interactive and administrative access must require multi-factor authentication. Single-factor authentication is not sufficient for accounts that can reach sensitive data or configuration.',
  category: 'Authentication',
  remediation:
    'Integrate an MFA provider (TOTP, WebAuthn, or push) at the identity layer; enforce it for all users with access to protected resources and for all administrative actions.',
} as const;

export const securityRequirementRules: RequirementRule[] = [
  // ---- PCI DSS (payment card data) -------------------------------------------
  {
    id: 'pci-input-validation',
    when: (p) => fw(p, 'PCI DSS'),
    emit: [{
      code: 'REQ-PCI-6.5.1-SQLI',
      title: 'Prevent injection flaws',
      description: 'Guard against injection (SQL, OS, LDAP) by validating input and using parameterized queries throughout the application.',
      category: 'Secure Coding',
      framework: 'PCI DSS', controlId: 'PCI DSS 6.5.1',
      severity: 'high', status: 'required',
      remediation: 'Use parameterized statements / prepared queries for all data access; validate and canonicalize input at trust boundaries.',
    }],
  },
  {
    id: 'pci-encrypt-at-rest',
    when: (p) => fw(p, 'PCI DSS') && data(p, 'card'),
    emit: [{
      code: 'REQ-PCI-3.4-ENCRYPT-AT-REST',
      title: 'Render stored cardholder data unreadable',
      description: 'Primary account numbers must be rendered unreadable anywhere they are stored, using strong cryptography.',
      category: 'Cryptography',
      framework: 'PCI DSS', controlId: 'PCI DSS 3.4',
      severity: 'critical', status: 'required',
      remediation: 'Encrypt PAN at rest (AES-256) or tokenize it; manage keys per PCI DSS 3.5/3.6.',
    }],
  },
  {
    id: 'pci-tls',
    when: (p) => fw(p, 'PCI DSS'),
    emit: [{
      code: 'REQ-PCI-4.1-TLS',
      title: 'Encrypt cardholder data in transit',
      description: 'Use strong cryptography and security protocols to safeguard sensitive data during transmission over open, public networks.',
      category: 'Cryptography',
      framework: 'PCI DSS', controlId: 'PCI DSS 4.1',
      severity: 'high', status: 'required',
      remediation: 'Require TLS 1.2+ with strong ciphers; disable legacy protocols (SSL, early TLS).',
    }],
  },
  {
    id: 'pci-audit-log',
    when: (p) => fw(p, 'PCI DSS'),
    emit: [{
      code: 'REQ-PCI-10.2-AUDIT-LOG',
      title: 'Log access to cardholder data',
      description: 'Implement automated audit trails to reconstruct access to system components and cardholder data.',
      category: 'Logging & Monitoring',
      framework: 'PCI DSS', controlId: 'PCI DSS 10.2',
      severity: 'medium', status: 'required',
      remediation: 'Emit tamper-evident audit events for all access to protected data, including user id, timestamp, and action.',
    }],
  },
  {
    id: 'pci-mfa',
    when: (p) => fw(p, 'PCI DSS'),
    emit: [{ ...MFA, framework: 'PCI DSS', controlId: 'PCI DSS 8.3.1', severity: 'high', status: 'required' }],
  },

  // ---- NIST 800-53 -----------------------------------------------------------
  {
    id: 'nist-mfa',
    when: (p) => fw(p, 'NIST 800-53'),
    emit: [{ ...MFA, framework: 'NIST 800-53', controlId: 'IA-2', severity: 'high', status: 'required' }],
  },
  {
    id: 'nist-account-mgmt',
    when: (p) => fw(p, 'NIST 800-53'),
    emit: [{
      code: 'REQ-NIST-AC-2-ACCOUNT-MGMT',
      title: 'Manage system accounts',
      description: 'Define, provision, review, and disable system accounts with least privilege and periodic recertification.',
      category: 'Access Control',
      framework: 'NIST 800-53', controlId: 'AC-2',
      severity: 'medium', status: 'required',
      remediation: 'Automate account lifecycle; enforce least privilege and periodic access reviews; disable dormant accounts.',
    }],
  },
  {
    id: 'nist-audit-events',
    when: (p) => fw(p, 'NIST 800-53'),
    emit: [{
      code: 'REQ-NIST-AU-2-AUDIT-EVENTS',
      title: 'Audit security-relevant events',
      description: 'Determine, log, and retain the set of auditable events needed to support after-the-fact investigations.',
      category: 'Logging & Monitoring',
      framework: 'NIST 800-53', controlId: 'AU-2',
      severity: 'medium', status: 'required',
      remediation: 'Define an auditable-event catalog; centralize logs with integrity protection and retention.',
    }],
  },
  {
    id: 'nist-crypto',
    when: (p) => fw(p, 'NIST 800-53'),
    emit: [{
      code: 'REQ-NIST-SC-13-CRYPTO',
      title: 'Use approved cryptography',
      description: 'Implement cryptographic protections using FIPS-validated or NSA-approved algorithms and modules.',
      category: 'Cryptography',
      framework: 'NIST 800-53', controlId: 'SC-13',
      severity: 'high', status: 'required',
      remediation: 'Use vetted, standard cryptographic libraries; avoid custom crypto; select FIPS-validated modules where required.',
    }],
  },

  // ---- SOC 2 -----------------------------------------------------------------
  {
    id: 'soc2-mfa',
    when: (p) => fw(p, 'SOC 2'),
    emit: [{ ...MFA, framework: 'SOC 2', controlId: 'CC6.1', severity: 'medium', status: 'recommended' }],
  },
  {
    id: 'soc2-monitoring',
    when: (p) => fw(p, 'SOC 2'),
    emit: [{
      code: 'REQ-SOC2-CC7.2-MONITORING',
      title: 'Monitor for anomalies and incidents',
      description: 'Monitor system components and the operation of controls to detect anomalies indicative of security events.',
      category: 'Logging & Monitoring',
      framework: 'SOC 2', controlId: 'CC7.2',
      severity: 'medium', status: 'recommended',
      remediation: 'Deploy detection/alerting on security-relevant signals; define response runbooks.',
    }],
  },
  {
    id: 'soc2-vuln-mgmt',
    when: (p) => fw(p, 'SOC 2'),
    emit: [{
      code: 'REQ-SOC2-CC6.6-VULN-MGMT',
      title: 'Manage vulnerabilities on external boundaries',
      description: 'Implement controls to prevent or detect and act upon the introduction of new vulnerabilities.',
      category: 'Vulnerability Management',
      framework: 'SOC 2', controlId: 'CC6.6',
      severity: 'medium', status: 'required',
      remediation: 'Run SCA/SAST/DAST in CI and gate releases on unresolved critical findings.',
    }],
  },

  // ---- ISO 27001 -------------------------------------------------------------
  {
    id: 'iso-crypto',
    when: (p) => fw(p, 'ISO 27001'),
    emit: [{
      code: 'REQ-ISO-A8.24-CRYPTO',
      title: 'Use cryptography per policy',
      description: 'Define and apply rules for the effective use of cryptography, including key management.',
      category: 'Cryptography',
      framework: 'ISO 27001', controlId: 'A.8.24',
      severity: 'medium', status: 'required',
      remediation: 'Adopt a cryptography policy covering algorithms, key lengths, rotation, and storage.',
    }],
  },
  {
    id: 'iso-access-control',
    when: (p) => fw(p, 'ISO 27001'),
    emit: [{
      code: 'REQ-ISO-A5.15-ACCESS-CONTROL',
      title: 'Enforce access control policy',
      description: 'Establish and implement rules to control physical and logical access based on business and security requirements.',
      category: 'Access Control',
      framework: 'ISO 27001', controlId: 'A.5.15',
      severity: 'medium', status: 'required',
      remediation: 'Implement role-based access control with least privilege and documented approval.',
    }],
  },

  // ---- HIPAA (health data) ---------------------------------------------------
  {
    id: 'hipaa-phi-encrypt',
    when: (p) => fw(p, 'HIPAA') && data(p, 'health'),
    emit: [{
      code: 'REQ-HIPAA-164.312-PHI-ENCRYPT',
      title: 'Encrypt electronic protected health information',
      description: 'Implement a mechanism to encrypt and decrypt ePHI at rest and in transit.',
      category: 'Cryptography',
      framework: 'HIPAA', controlId: '45 CFR 164.312(a)(2)(iv)',
      severity: 'critical', status: 'required',
      remediation: 'Encrypt ePHI at rest (AES-256) and enforce TLS in transit; manage keys under access control.',
    }],
  },
  {
    id: 'hipaa-audit',
    when: (p) => fw(p, 'HIPAA') && data(p, 'health'),
    emit: [{
      code: 'REQ-HIPAA-164.312-AUDIT',
      title: 'Record and examine ePHI access',
      description: 'Implement hardware, software, and procedural mechanisms that record and examine activity in systems containing ePHI.',
      category: 'Logging & Monitoring',
      framework: 'HIPAA', controlId: '45 CFR 164.312(b)',
      severity: 'high', status: 'required',
      remediation: 'Log all ePHI access with user, timestamp, and action; review logs regularly.',
    }],
  },
  {
    id: 'hipaa-access',
    when: (p) => fw(p, 'HIPAA'),
    emit: [{
      code: 'REQ-HIPAA-164.308-ACCESS',
      title: 'Authorize access to ePHI',
      description: 'Implement policies and procedures for granting access to ePHI on a need-to-know basis.',
      category: 'Access Control',
      framework: 'HIPAA', controlId: '45 CFR 164.308(a)(4)',
      severity: 'high', status: 'required',
      remediation: 'Enforce least-privilege access to ePHI with documented authorization and periodic review.',
    }],
  },

  // ---- GDPR (personal data) --------------------------------------------------
  {
    id: 'gdpr-encryption',
    when: (p) => fw(p, 'GDPR') && data(p, 'pii'),
    emit: [{
      code: 'REQ-GDPR-ART32-ENCRYPTION',
      title: 'Secure processing of personal data',
      description: 'Implement appropriate technical measures, including encryption and pseudonymization, to ensure a level of security appropriate to the risk.',
      category: 'Cryptography',
      framework: 'GDPR', controlId: 'GDPR Art. 32',
      severity: 'high', status: 'required',
      remediation: 'Encrypt or pseudonymize personal data at rest and in transit; document the technical measures.',
    }],
  },
  {
    id: 'gdpr-data-minimization',
    when: (p) => fw(p, 'GDPR') && data(p, 'pii'),
    emit: [{
      code: 'REQ-GDPR-ART25-DATA-MINIMIZATION',
      title: 'Data protection by design and default',
      description: 'Collect and process only the personal data necessary for each specific purpose, by design and by default.',
      category: 'Privacy',
      framework: 'GDPR', controlId: 'GDPR Art. 25',
      severity: 'medium', status: 'required',
      remediation: 'Review data collection; drop unnecessary fields; default to the least-permissive processing.',
    }],
  },
  {
    id: 'gdpr-breach-notification',
    when: (p) => fw(p, 'GDPR'),
    emit: [{
      code: 'REQ-GDPR-ART33-BREACH-NOTIFICATION',
      title: 'Breach detection and notification readiness',
      description: 'Be able to detect a personal-data breach and notify the supervisory authority within 72 hours.',
      category: 'Incident Response',
      framework: 'GDPR', controlId: 'GDPR Art. 33',
      severity: 'medium', status: 'required',
      remediation: 'Establish breach detection, an incident runbook, and a 72-hour notification process.',
    }],
  },

  // ---- Cross-cutting authentication hardening --------------------------------
  {
    id: 'pci-strong-auth',
    when: (p) => fw(p, 'PCI DSS') && p.authModel !== 'none',
    emit: [{
      code: 'REQ-PCI-8.2-STRONG-AUTH',
      title: 'Enforce strong authentication credentials',
      description: 'Ensure proper user-authentication management, including strong password policies and secure credential storage.',
      category: 'Authentication',
      framework: 'PCI DSS', controlId: 'PCI DSS 8.2',
      severity: 'medium', status: 'required',
      remediation: 'Enforce password complexity/rotation or passwordless auth; store credentials with a strong adaptive hash (bcrypt/argon2).',
    }],
  },
];
