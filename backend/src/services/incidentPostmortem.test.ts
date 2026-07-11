import { buildPostmortemPatch, LIFECYCLE_PHASES } from './incidentPostmortem';

test('valid input yields a trimmed patch', () => {
  const out = buildPostmortemPatch({ rootCause: '  SQLi in search  ', escapedPhase: 'test', lessons: 'add DAST auth\nfix param binding' });
  expect(out).toEqual({ ok: true, patch: { rootCause: 'SQLi in search', escapedPhase: 'test', lessons: 'add DAST auth\nfix param binding' } });
});

test('missing rootCause rejected', () => {
  const out = buildPostmortemPatch({ rootCause: '   ', escapedPhase: 'test' });
  expect(out.ok).toBe(false);
});

test('unknown escapedPhase rejected', () => {
  const out = buildPostmortemPatch({ rootCause: 'x', escapedPhase: 'qa' });
  expect(out.ok).toBe(false);
});

test('lessons optional, defaults empty; non-string inputs rejected', () => {
  const ok = buildPostmortemPatch({ rootCause: 'x', escapedPhase: 'build' });
  expect(ok).toEqual({ ok: true, patch: { rootCause: 'x', escapedPhase: 'build', lessons: '' } });
  expect(buildPostmortemPatch({ rootCause: 42, escapedPhase: 'build' }).ok).toBe(false);
});

test('phase enum is the 8 lifecycle stages', () => {
  expect([...LIFECYCLE_PHASES]).toEqual(['plan', 'code', 'build', 'test', 'release', 'deploy', 'operate', 'monitor']);
});
