export const LIFECYCLE_PHASES = ['plan', 'code', 'build', 'test', 'release', 'deploy', 'operate', 'monitor'] as const;

export interface PostmortemInput { rootCause?: unknown; escapedPhase?: unknown; lessons?: unknown; }
export interface PostmortemPatch { rootCause: string; escapedPhase: string; lessons: string; }

export function buildPostmortemPatch(input: PostmortemInput):
  { ok: true; patch: PostmortemPatch } | { ok: false; error: string } {
  if (typeof input.rootCause !== 'string' || input.rootCause.trim() === '') {
    return { ok: false, error: 'rootCause is required' };
  }
  if (typeof input.escapedPhase !== 'string' || !(LIFECYCLE_PHASES as readonly string[]).includes(input.escapedPhase)) {
    return { ok: false, error: `escapedPhase must be one of: ${LIFECYCLE_PHASES.join(', ')}` };
  }
  if (input.lessons !== undefined && typeof input.lessons !== 'string') {
    return { ok: false, error: 'lessons must be a string' };
  }
  return { ok: true, patch: { rootCause: input.rootCause.trim(), escapedPhase: input.escapedPhase, lessons: (input.lessons ?? '') as string } };
}
