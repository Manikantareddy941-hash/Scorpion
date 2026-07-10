jest.mock('./redisConnection', () => ({ redisConnection: {} }));
jest.mock('bullmq', () => ({
  Queue: jest.fn().mockImplementation(() => ({ add: jest.fn() })),
  Worker: jest.fn(),
}));
jest.mock('../monitor/securityEventSource', () => ({
  securityEventSource: { collect: jest.fn() }, recordSecurityEvent: jest.fn(),
}));
jest.mock('../repositories/correlationRepository', () => ({
  correlationRepository: { wasFired: jest.fn(), recordFired: jest.fn(), listRuleStates: jest.fn() },
}));
jest.mock('../repositories/suppressionRepository', () => ({
  suppressionRepository: { listForOwner: jest.fn() },
}));
jest.mock('../services/incidentService', () => ({ createIncident: jest.fn() }));

import { runCorrelationTick, __resetSpikeDedupeForTests } from './correlationQueueWorker';
import { securityEventSource } from '../monitor/securityEventSource';
import { correlationRepository } from '../repositories/correlationRepository';
import { suppressionRepository } from '../repositories/suppressionRepository';
import { createIncident } from '../services/incidentService';
import { statusTelemetry } from '../monitor/statusTelemetry';
import type { SecurityEvent } from '../monitor/securityEvent.types';

const t = 1_000_000;
const evs: SecurityEvent[] = [
  { id: '1', type: 'recon', srcIp: 'A', ownerUserId: 'u1', severity: 'high', timestamp: t },
  { id: '2', type: 'exploit', srcIp: 'A', ownerUserId: 'u1', severity: 'high', timestamp: t + 1 },
];

beforeEach(() => {
  jest.clearAllMocks();
  __resetSpikeDedupeForTests();
  statusTelemetry.reset();
  (securityEventSource.collect as jest.Mock).mockResolvedValue(evs);
  (correlationRepository.listRuleStates as jest.Mock).mockResolvedValue([]);
  (correlationRepository.wasFired as jest.Mock).mockResolvedValue(false);
  (suppressionRepository.listForOwner as jest.Mock).mockResolvedValue([]);
  (createIncident as jest.Mock).mockResolvedValue({ $id: 'inc1' });
});

test('creates a correlated incident and records it once', async () => {
  const out = await runCorrelationTick('u1');
  expect(out).toHaveLength(1);
  expect(createIncident).toHaveBeenCalledWith(expect.objectContaining({ source: 'correlation', userId: 'u1' }));
  expect(correlationRepository.recordFired).toHaveBeenCalledTimes(1);
});

test('does not re-fire an already-fired correlation', async () => {
  (correlationRepository.wasFired as jest.Mock).mockResolvedValue(true);
  await runCorrelationTick('u1');
  expect(createIncident).not.toHaveBeenCalled();
});

test('suppressed correlation creates no incident', async () => {
  (suppressionRepository.listForOwner as jest.Mock).mockResolvedValue([
    { id: 's1', matchType: 'ruleId', matchValue: 'recon-to-exploit' },
  ]);
  await runCorrelationTick('u1');
  expect(createIncident).not.toHaveBeenCalled();
});

test('creates an apm incident from a status spike', async () => {
  for (let i = 0; i < 12; i += 1) statusTelemetry.record('spike-src', 403);
  for (let i = 0; i < 3; i += 1) statusTelemetry.record('spike-src', 200);

  await runCorrelationTick('system');

  expect(createIncident).toHaveBeenCalledWith(expect.objectContaining({ source: 'apm', userId: 'system' }));
});

test('does not double-fire an apm incident for the same spike within one minute', async () => {
  for (let i = 0; i < 12; i += 1) statusTelemetry.record('spike-src', 403);
  for (let i = 0; i < 3; i += 1) statusTelemetry.record('spike-src', 200);

  await runCorrelationTick('system');
  await runCorrelationTick('system');

  const apmCalls = (createIncident as jest.Mock).mock.calls.filter(([arg]) => arg.source === 'apm');
  expect(apmCalls).toHaveLength(1);
});

test('does not process app-global status spikes on a non-system owner tick', async () => {
  for (let i = 0; i < 12; i += 1) statusTelemetry.record('spike-src', 403);
  for (let i = 0; i < 3; i += 1) statusTelemetry.record('spike-src', 200);

  await runCorrelationTick('u1');

  const apmCalls = (createIncident as jest.Mock).mock.calls.filter(([arg]) => arg.source === 'apm');
  expect(apmCalls).toHaveLength(0);
});
