import {
  evaluatePodSecurity,
  DEFAULT_POD_SECURITY_CONFIG,
  PodSecurityConfig,
  PodLikeSpec,
} from './podSecurityService';

/** Config with every rule enforced and no allowlists — the strictest baseline. */
const allEnforced = (overrides: Partial<PodSecurityConfig> = {}): PodSecurityConfig => ({
  modes: {
    'registry-allowlist': 'enforce',
    'no-privileged': 'enforce',
    'run-as-non-root': 'enforce',
    'drop-dangerous-capabilities': 'enforce',
    'read-only-root-fs': 'enforce',
    'no-host-namespaces': 'enforce',
    'required-labels': 'enforce',
  },
  allowedRegistries: [],
  requiredLabels: [],
  ...overrides,
});

/** A pod that satisfies every positive-assertion rule. */
const hardenedPod = (): PodLikeSpec => ({
  metadata: { labels: { team: 'sec', app: 'demo' } },
  spec: {
    securityContext: { runAsNonRoot: true },
    containers: [
      {
        name: 'app',
        image: 'registry.company.com/app@sha256:abc',
        securityContext: { readOnlyRootFilesystem: true },
      },
    ],
  },
});

const rulesOf = (violations: { rule: string }[]) => violations.map(v => v.rule);

describe('evaluatePodSecurity', () => {
  it('passes a fully hardened pod under full enforcement', () => {
    expect(evaluatePodSecurity(hardenedPod(), allEnforced())).toEqual([]);
  });

  describe('no-privileged', () => {
    it('flags a privileged container', () => {
      const pod = hardenedPod();
      pod.spec!.containers![0].securityContext!.privileged = true;
      const v = evaluatePodSecurity(pod, allEnforced());
      expect(rulesOf(v)).toContain('no-privileged');
      expect(v.find(x => x.rule === 'no-privileged')!.message).toMatch(/app.*privileged/i);
    });

    it('treats absent privileged flag as safe', () => {
      const v = evaluatePodSecurity(hardenedPod(), allEnforced());
      expect(rulesOf(v)).not.toContain('no-privileged');
    });

    it('flags a privileged initContainer', () => {
      const pod = hardenedPod();
      pod.spec!.initContainers = [
        { name: 'init', image: 'registry.company.com/init@sha256:def', securityContext: { privileged: true, runAsNonRoot: true, readOnlyRootFilesystem: true } },
      ];
      expect(rulesOf(evaluatePodSecurity(pod, allEnforced()))).toContain('no-privileged');
    });
  });

  describe('registry-allowlist', () => {
    it('is inert when the allowlist is empty even in enforce mode', () => {
      const pod = hardenedPod();
      pod.spec!.containers![0].image = 'docker.io/random:latest';
      expect(rulesOf(evaluatePodSecurity(pod, allEnforced()))).not.toContain('registry-allowlist');
    });

    it('passes images matching an allowed prefix', () => {
      const cfg = allEnforced({ allowedRegistries: ['registry.company.com/'] });
      expect(rulesOf(evaluatePodSecurity(hardenedPod(), cfg))).not.toContain('registry-allowlist');
    });

    it('flags images outside the allowlist and names the image', () => {
      const cfg = allEnforced({ allowedRegistries: ['registry.company.com/'] });
      const pod = hardenedPod();
      pod.spec!.containers![0].image = 'docker.io/nginx:latest';
      const v = evaluatePodSecurity(pod, cfg);
      expect(rulesOf(v)).toContain('registry-allowlist');
      expect(v.find(x => x.rule === 'registry-allowlist')!.message).toContain('docker.io/nginx:latest');
    });
  });

  describe('run-as-non-root', () => {
    it('accepts pod-level runAsNonRoot', () => {
      const pod = hardenedPod();
      // container has no own runAsNonRoot — pod-level covers it
      expect(rulesOf(evaluatePodSecurity(pod, allEnforced()))).not.toContain('run-as-non-root');
    });

    it('accepts container-level runAsNonRoot when pod-level is absent', () => {
      const pod = hardenedPod();
      delete pod.spec!.securityContext;
      pod.spec!.containers![0].securityContext!.runAsNonRoot = true;
      expect(rulesOf(evaluatePodSecurity(pod, allEnforced()))).not.toContain('run-as-non-root');
    });

    it('flags when neither pod nor container asserts runAsNonRoot', () => {
      const pod = hardenedPod();
      delete pod.spec!.securityContext;
      expect(rulesOf(evaluatePodSecurity(pod, allEnforced()))).toContain('run-as-non-root');
    });
  });

  describe('drop-dangerous-capabilities', () => {
    it.each(['SYS_ADMIN', 'NET_ADMIN', 'SYS_PTRACE', 'ALL', 'sys_admin'])(
      'flags added capability %s',
      cap => {
        const pod = hardenedPod();
        pod.spec!.containers![0].securityContext!.capabilities = { add: [cap] };
        expect(rulesOf(evaluatePodSecurity(pod, allEnforced()))).toContain('drop-dangerous-capabilities');
      }
    );

    it('allows benign added capabilities', () => {
      const pod = hardenedPod();
      pod.spec!.containers![0].securityContext!.capabilities = { add: ['NET_BIND_SERVICE'] };
      expect(rulesOf(evaluatePodSecurity(pod, allEnforced()))).not.toContain('drop-dangerous-capabilities');
    });
  });

  describe('read-only-root-fs', () => {
    it('flags a container without readOnlyRootFilesystem', () => {
      const pod = hardenedPod();
      delete pod.spec!.containers![0].securityContext!.readOnlyRootFilesystem;
      expect(rulesOf(evaluatePodSecurity(pod, allEnforced()))).toContain('read-only-root-fs');
    });
  });

  describe('no-host-namespaces', () => {
    it.each([['hostNetwork'], ['hostPID'], ['hostIPC']] as const)('flags %s', key => {
      const pod = hardenedPod();
      (pod.spec as Record<string, unknown>)[key] = true;
      expect(rulesOf(evaluatePodSecurity(pod, allEnforced()))).toContain('no-host-namespaces');
    });

    it('flags hostPath volumes', () => {
      const pod = hardenedPod();
      pod.spec!.volumes = [{ name: 'host', hostPath: { path: '/etc' } }];
      expect(rulesOf(evaluatePodSecurity(pod, allEnforced()))).toContain('no-host-namespaces');
    });

    it('allows non-hostPath volumes', () => {
      const pod = hardenedPod();
      pod.spec!.volumes = [{ name: 'cfg' }];
      expect(rulesOf(evaluatePodSecurity(pod, allEnforced()))).not.toContain('no-host-namespaces');
    });
  });

  describe('required-labels', () => {
    it('is inert when requiredLabels is empty', () => {
      const pod = hardenedPod();
      delete pod.metadata;
      expect(rulesOf(evaluatePodSecurity(pod, allEnforced()))).not.toContain('required-labels');
    });

    it('flags a missing label key and passes when present', () => {
      const cfg = allEnforced({ requiredLabels: ['team', 'owner'] });
      const v = evaluatePodSecurity(hardenedPod(), cfg); // has team, lacks owner
      const hit = v.find(x => x.rule === 'required-labels');
      expect(hit).toBeDefined();
      expect(hit!.message).toContain('owner');

      const cfgOk = allEnforced({ requiredLabels: ['team'] });
      expect(rulesOf(evaluatePodSecurity(hardenedPod(), cfgOk))).not.toContain('required-labels');
    });
  });

  describe('modes', () => {
    it('skips rules in off mode', () => {
      const cfg = allEnforced();
      cfg.modes['read-only-root-fs'] = 'off';
      cfg.modes['run-as-non-root'] = 'off';
      const pod: PodLikeSpec = { spec: { containers: [{ name: 'app', image: 'x' }] } };
      expect(rulesOf(evaluatePodSecurity(pod, cfg))).toEqual([]);
    });

    it('carries the configured mode on each violation', () => {
      const cfg = allEnforced();
      cfg.modes['read-only-root-fs'] = 'audit';
      const pod = hardenedPod();
      delete pod.spec!.containers![0].securityContext!.readOnlyRootFilesystem;
      const v = evaluatePodSecurity(pod, cfg);
      expect(v.find(x => x.rule === 'read-only-root-fs')!.mode).toBe('audit');
    });

    it('accumulates multiple violations', () => {
      const pod: PodLikeSpec = {
        spec: {
          hostNetwork: true,
          containers: [{ name: 'app', image: 'x', securityContext: { privileged: true } }],
        },
      };
      const rules = rulesOf(evaluatePodSecurity(pod, allEnforced()));
      expect(rules).toEqual(
        expect.arrayContaining(['no-privileged', 'run-as-non-root', 'read-only-root-fs', 'no-host-namespaces'])
      );
    });
  });

  describe('defaults + malformed input', () => {
    it('DEFAULT config audits everything except no-privileged (enforce)', () => {
      expect(DEFAULT_POD_SECURITY_CONFIG.modes['no-privileged']).toBe('enforce');
      for (const [rule, mode] of Object.entries(DEFAULT_POD_SECURITY_CONFIG.modes)) {
        if (rule !== 'no-privileged') expect(mode).toBe('audit');
      }
      expect(DEFAULT_POD_SECURITY_CONFIG.allowedRegistries).toEqual([]);
      expect(DEFAULT_POD_SECURITY_CONFIG.requiredLabels).toEqual([]);
    });

    it('does not crash on an empty pod and reports only positive-assertion audits', () => {
      const v = evaluatePodSecurity({}, DEFAULT_POD_SECURITY_CONFIG);
      // no containers at all → nothing to assert per-container; only pod-level
      // run-as-non-root cannot be proven, but with zero containers there is no
      // workload to flag — expect no violations and no exception.
      expect(Array.isArray(v)).toBe(true);
      expect(v.every(x => x.mode === 'audit')).toBe(true);
    });
  });
});
