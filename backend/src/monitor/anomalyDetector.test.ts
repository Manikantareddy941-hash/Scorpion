import { detectStatusSpike } from './anomalyDetector';

const th = { minDenied: 10, minShare: 0.5 };

test('flags a bucket exceeding both count and share', () => {
  const out = detectStatusSpike([{ key: '1.2.3.4', total: 20, denied: 15, minute: 1 }], th);
  expect(out).toHaveLength(1);
  expect(out[0].key).toBe('1.2.3.4');
});

test('ignores high count when share is low (legit traffic)', () => {
  expect(detectStatusSpike([{ key: 'x', total: 1000, denied: 12, minute: 1 }], th)).toHaveLength(0);
});

test('ignores high share when count is tiny (noise)', () => {
  expect(detectStatusSpike([{ key: 'x', total: 3, denied: 3, minute: 1 }], th)).toHaveLength(0);
});
