import { PROVENANCE_MAX_BYTES, ToolProvenance, oldestDatabase, serializeProvenance } from './provenance';

const entry = (tool: string, dbBuiltAt?: string): ToolProvenance => ({
    tool,
    image: `ghcr.io/acme/scorpion-${tool}@sha256:${'a'.repeat(64)}`,
    digest: `sha256:${'a'.repeat(64)}`,
    ...(dbBuiltAt ? { dbBuiltAt } : {}),
    freshness: 'fresh',
});

describe('oldestDatabase', () => {
    test('picks the oldest, because a verdict is only as current as its weakest scanner', () => {
        // Reporting the newest would let one freshly-baked scanner vouch for
        // another running months behind.
        const oldest = oldestDatabase([
            entry('trivy', '2026-08-01T00:00:00.000Z'),
            entry('semgrep', '2026-07-20T00:00:00.000Z'),
        ]);

        expect(oldest).toBe('2026-07-20T00:00:00.000Z');
    });

    test('ignores tools that carry no database at all', () => {
        // gitleaks and hadolint compile their rules in — there is nothing to be
        // stale about, and treating "no database" as "infinitely old" would
        // make every scan look ancient.
        const oldest = oldestDatabase([entry('gitleaks'), entry('trivy', '2026-08-01T00:00:00.000Z')]);

        expect(oldest).toBe('2026-08-01T00:00:00.000Z');
    });

    test('is undefined when nothing carried a database', () => {
        expect(oldestDatabase([entry('gitleaks'), entry('hadolint')])).toBeUndefined();
    });

    test('is undefined for an empty scan rather than throwing', () => {
        expect(oldestDatabase([])).toBeUndefined();
    });
});

describe('serializeProvenance', () => {
    test('round-trips a normal scan', () => {
        const entries = [entry('trivy', '2026-08-01T00:00:00.000Z'), entry('gitleaks')];

        expect(JSON.parse(serializeProvenance(entries))).toEqual(entries);
    });

    test('stays within the column rather than failing the write', () => {
        // An oversize write would fail the whole scan record — losing the
        // findings in order to save the metadata about them.
        const many = Array.from({ length: 200 }, (_, i) => entry(`tool-${i}`, '2026-08-01T00:00:00.000Z'));

        const serialized = serializeProvenance(many);

        expect(serialized.length).toBeLessThanOrEqual(PROVENANCE_MAX_BYTES);
    });

    test('marks a truncated record, so a reader does not read it as complete', () => {
        // Without the marker, dropped tools look like tools that never ran.
        const many = Array.from({ length: 200 }, (_, i) => entry(`tool-${i}`, '2026-08-01T00:00:00.000Z'));

        const parsed = JSON.parse(serializeProvenance(many)) as ToolProvenance[];

        expect(parsed.some(e => e.tool === '_truncated')).toBe(true);
        expect(parsed.length).toBeLessThan(200);
    });

    test('does not add a marker when everything fits', () => {
        const parsed = JSON.parse(serializeProvenance([entry('trivy', '2026-08-01T00:00:00.000Z')])) as ToolProvenance[];

        expect(parsed.some(e => e.tool === '_truncated')).toBe(false);
    });
});
