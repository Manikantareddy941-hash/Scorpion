jest.mock('./logger', () => ({
    // Spread rather than replace: this module also exports errorContext,
    // and a factory that returns only `logger` makes it undefined at runtime.
    ...jest.requireActual('./logger'),
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() }
}));

import {
  fetchEpssScores,
  loadKevCatalog,
  computeRiskScore,
  enrichIssues,
  __resetEnrichmentCaches
} from './enrichmentService';

const fetchMock = jest.fn();
global.fetch = fetchMock as unknown as typeof fetch;

beforeEach(() => {
  fetchMock.mockReset();
  __resetEnrichmentCaches();
});

function epssResponse(rows: Array<{ cve: string; epss: string; percentile: string }>) {
  return {
    ok: true,
    json: async () => ({ data: rows })
  };
}

function kevResponse(cveIds: string[]) {
  return {
    ok: true,
    json: async () => ({
      vulnerabilities: cveIds.map((cveID) => ({ cveID }))
    })
  };
}

describe('fetchEpssScores', () => {
  it('maps CVE ids to scores', async () => {
    fetchMock.mockResolvedValueOnce(
      epssResponse([{ cve: 'CVE-2024-1', epss: '0.97', percentile: '0.999' }])
    );

    const scores = await fetchEpssScores(['CVE-2024-1']);

    expect(scores.get('CVE-2024-1')).toEqual({ score: 0.97, percentile: 0.999 });
  });

  it('batches requests in chunks of 100', async () => {
    const ids = Array.from({ length: 150 }, (_, i) => `CVE-2024-${i}`);
    fetchMock.mockResolvedValue(epssResponse([]));

    await fetchEpssScores(ids);

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('returns an empty map when the API fails', async () => {
    fetchMock.mockRejectedValue(new Error('network down'));

    const scores = await fetchEpssScores(['CVE-2024-1']);

    expect(scores.size).toBe(0);
  });
});

describe('loadKevCatalog', () => {
  it('returns the set of known-exploited CVE ids and caches it', async () => {
    fetchMock.mockResolvedValueOnce(kevResponse(['CVE-2024-9']));

    const kev1 = await loadKevCatalog();
    const kev2 = await loadKevCatalog();

    expect(kev1.has('CVE-2024-9')).toBe(true);
    expect(kev2.has('CVE-2024-9')).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1); // cached
  });

  it('returns an empty set when the feed fails and nothing is cached', async () => {
    fetchMock.mockRejectedValue(new Error('feed down'));

    const kev = await loadKevCatalog();

    expect(kev.size).toBe(0);
  });
});

describe('computeRiskScore', () => {
  it('ranks KEV + high EPSS critical at the cap', () => {
    expect(computeRiskScore('critical', 0.97, true)).toBe(100);
  });

  it('ranks a plain low with no intel near the floor', () => {
    expect(computeRiskScore('low', undefined, false)).toBe(10);
  });

  it('a medium with high EPSS outranks a plain high', () => {
    const mediumExploited = computeRiskScore('medium', 0.9, false);
    const plainHigh = computeRiskScore('high', undefined, false);
    expect(mediumExploited).toBeGreaterThan(plainHigh);
  });
});

describe('enrichIssues', () => {
  it('stamps epss/kev/risk_score onto CVE-bearing issues without mutating input', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).includes('first.org')) {
        return epssResponse([{ cve: 'CVE-2024-1', epss: '0.5', percentile: '0.9' }]);
      }
      return kevResponse(['CVE-2024-1']);
    });

    const input = [
      { cveId: 'CVE-2024-1', severity: 'high', title: 'vuln' },
      { severity: 'medium', title: 'sast finding' }
    ];
    const inputSnapshot = JSON.parse(JSON.stringify(input));

    const out = await enrichIssues(input);

    expect(input).toEqual(inputSnapshot); // immutable
    expect(out[0].epss_score).toBe(0.5);
    expect(out[0].epss_percentile).toBe(0.9);
    expect(out[0].kev).toBe(true);
    expect(out[0].risk_score).toBeGreaterThan(out[1].risk_score as number);
    // non-CVE issue still gets a severity-derived score
    expect(out[1].risk_score).toBe(20);
    expect(out[1].kev).toBe(false);
  });

  it('still returns scored issues when both feeds are down', async () => {
    fetchMock.mockRejectedValue(new Error('offline'));

    const out = await enrichIssues([{ cveId: 'CVE-2024-1', severity: 'critical', title: 'x' }]);

    expect(out[0].risk_score).toBe(50);
    expect(out[0].kev).toBe(false);
    expect(out[0].epss_score).toBeUndefined();
  });
});
