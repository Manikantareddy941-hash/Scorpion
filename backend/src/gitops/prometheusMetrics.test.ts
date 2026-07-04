import axios from 'axios';

jest.mock('axios');
jest.mock('../services/logger', () => ({ logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn() } }));

import { queryCanaryMetrics } from './prometheusMetrics';

const mockGet = axios.get as jest.MockedFunction<typeof axios.get>;

const promResponse = (value: string) => ({
  data: { status: 'success', data: { result: [{ value: [1700000000, value] }] } },
});

describe('queryCanaryMetrics', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.PROMETHEUS_URL = 'http://prom:9090';
  });

  afterEach(() => {
    delete process.env.PROMETHEUS_URL;
  });

  it('parses both metrics from valid responses', async () => {
    mockGet
      .mockResolvedValueOnce(promResponse('1.5'))
      .mockResolvedValueOnce(promResponse('320'));
    const m = await queryCanaryMetrics('demo', 'prod');
    expect(m).toEqual({ errorRatePct: 1.5, p95LatencyMs: 320 });
  });

  it('returns null for an empty result set', async () => {
    mockGet
      .mockResolvedValueOnce({ data: { status: 'success', data: { result: [] } } })
      .mockResolvedValueOnce(promResponse('100'));
    const m = await queryCanaryMetrics('demo', 'prod');
    expect(m.errorRatePct).toBeNull();
    expect(m.p95LatencyMs).toBe(100);
  });

  it('returns null when the query request fails (never throws)', async () => {
    mockGet.mockRejectedValue(new Error('ECONNREFUSED'));
    const m = await queryCanaryMetrics('demo', 'prod');
    expect(m).toEqual({ errorRatePct: null, p95LatencyMs: null });
  });

  it('returns null for a NaN sample value', async () => {
    mockGet
      .mockResolvedValueOnce(promResponse('NaN'))
      .mockResolvedValueOnce(promResponse('50'));
    const m = await queryCanaryMetrics('demo', 'prod');
    expect(m.errorRatePct).toBeNull();
  });

  it('returns null for a non-success status', async () => {
    mockGet.mockResolvedValue({ data: { status: 'error', data: { result: [] } } });
    const m = await queryCanaryMetrics('demo', 'prod');
    expect(m).toEqual({ errorRatePct: null, p95LatencyMs: null });
  });

  it('short-circuits to nulls when PROMETHEUS_URL is unset', async () => {
    delete process.env.PROMETHEUS_URL;
    const m = await queryCanaryMetrics('demo', 'prod');
    expect(m).toEqual({ errorRatePct: null, p95LatencyMs: null });
    expect(mockGet).not.toHaveBeenCalled();
  });

  it('escapes quotes and backslashes in label values', async () => {
    mockGet.mockResolvedValue(promResponse('1'));
    await queryCanaryMetrics('de"mo\\evil', 'prod');
    const query = (mockGet.mock.calls[0][1] as { params: { query: string } }).params.query;
    expect(query).toContain('de\\"mo\\\\evil');
    expect(query).not.toContain('de"mo');
  });
});
