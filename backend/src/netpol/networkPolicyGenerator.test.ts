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
    expect(yaml).toContain('name: allow-web-to-api');
    expect(yaml).toContain('name: allow-egress-web-to-api');
    expect(yaml).toContain('app: web');
    expect(yaml).toContain('app: api');
    expect(yaml).toContain('port: 8080');
  });

  it('stamps the namespace on every document', () => {
    const yaml = generateNetworkPolicies(input);
    expect((yaml.match(/namespace: prod/g) ?? []).length).toBe(4); // deny-all, dns, ingress, egress
  });

  it('sanitizes service names for policy names', () => {
    const yaml = generateNetworkPolicies({ namespace: 'prod', flows: [{ from: 'My_Web', to: 'API v2', port: 80 }] });
    expect(yaml).toContain('name: allow-my-web-to-api-v2');
  });

  it('no flows yields just deny-all + dns', () => {
    const yaml = generateNetworkPolicies({ namespace: 'prod', flows: [] });
    expect((yaml.match(/kind: NetworkPolicy/g) ?? []).length).toBe(2);
  });
});
