import { generateNetworkPolicies } from './networkPolicyGenerator';

describe('generateNetworkPolicies', () => {
  const input = { namespace: 'prod', flows: [{ from: 'web', to: 'api', port: 8080 }] };

  it('emits default-deny-all covering ingress and egress', () => {
    const yaml = generateNetworkPolicies(input);
    expect(yaml).toContain('name: default-deny-all');
    expect(yaml).toContain('- Ingress');
    expect(yaml).toContain('- Egress');
  });

  it('emits a DNS egress allowance', () => {
    const yaml = generateNetworkPolicies(input);
    expect(yaml).toContain('name: allow-dns');
    expect(yaml).toContain('port: 53');
  });

  it('emits paired ingress+egress policies per flow', () => {
    const yaml = generateNetworkPolicies(input);
    expect(yaml).toContain('name: allow-web-to-api-8080');
    expect(yaml).toContain('name: allow-egress-web-to-api-8080');
    expect(yaml).toContain('app: web');
    expect(yaml).toContain('app: api');
    expect(yaml).toContain('port: 8080');
  });

  it('same pair on different ports yields distinct policy names', () => {
    const yaml = generateNetworkPolicies({
      namespace: 'prod',
      flows: [
        { from: 'web', to: 'api', port: 8080 },
        { from: 'web', to: 'api', port: 9090 },
      ],
    });
    expect(yaml).toContain('name: allow-web-to-api-8080');
    expect(yaml).toContain('name: allow-web-to-api-9090');
    expect(yaml).toContain('name: allow-egress-web-to-api-8080');
    expect(yaml).toContain('name: allow-egress-web-to-api-9090');
    expect((yaml.match(/kind: NetworkPolicy/g) ?? []).length).toBe(6);
  });

  it('stamps the namespace on every document', () => {
    const yaml = generateNetworkPolicies(input);
    expect((yaml.match(/namespace: prod/g) ?? []).length).toBe(4); // deny-all, dns, ingress, egress
  });

  it('sanitizes service names for policy names', () => {
    const yaml = generateNetworkPolicies({ namespace: 'prod', flows: [{ from: 'My_Web', to: 'API.v2', port: 80 }] });
    expect(yaml).toContain('name: allow-my-web-to-api-v2-80');
  });

  it('throws on a namespace that is not DNS-1123', () => {
    expect(() => generateNetworkPolicies({ namespace: 'prod\nkind: Evil', flows: [] })).toThrow(/namespace/i);
    expect(() => generateNetworkPolicies({ namespace: 'Prod', flows: [] })).toThrow(/namespace/i);
    expect(() => generateNetworkPolicies({ namespace: '', flows: [] })).toThrow(/namespace/i);
  });

  it('skips flows with malicious labels but keeps valid siblings, output stays parseable', () => {
    const yaml = generateNetworkPolicies({
      namespace: 'prod',
      flows: [
        { from: 'evil\n  namespace: pwned', to: 'api', port: 80 },
        { from: 'web', to: 'api', port: 8080 },
      ],
    });
    expect(yaml).not.toContain('pwned');
    expect(yaml).toContain('name: allow-web-to-api-8080');
    // deny-all + dns + 1 valid pair; malicious flow dropped (traffic stays denied)
    expect((yaml.match(/kind: NetworkPolicy/g) ?? []).length).toBe(4);
  });

  it('no flows yields just deny-all + dns', () => {
    const yaml = generateNetworkPolicies({ namespace: 'prod', flows: [] });
    expect((yaml.match(/kind: NetworkPolicy/g) ?? []).length).toBe(2);
  });
});
