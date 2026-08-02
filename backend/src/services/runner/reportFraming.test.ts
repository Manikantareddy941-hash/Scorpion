import { createHash } from 'crypto';
import { BEGIN_MARKER, END_MARKER, emitReportCommand, parseFramedReport } from './reportFraming';

const frame = (body: string, over: { size?: number; digest?: string } = {}) => {
  const size = over.size ?? Buffer.byteLength(body, 'utf8');
  const digest = over.digest ?? createHash('sha256').update(body, 'utf8').digest('hex');
  return `${BEGIN_MARKER}\n${body}\n${END_MARKER}:${size}:${digest}\n`;
};

const REPORT = '{"Results":[{"Vulnerabilities":[]}]}';

test('extracts a well-framed report', () => {
  expect(parseFramedReport(frame(REPORT))).toEqual({ ok: true, body: REPORT });
});

test('ignores scanner noise around the frame', () => {
  // The report shares stdout with progress output; the frame is what makes it
  // recoverable at all.
  const noisy = `resolving db...\n${frame(REPORT)}done in 4s\n`;

  expect(parseFramedReport(noisy)).toEqual({ ok: true, body: REPORT });
});

test('a multi-line report survives intact', () => {
  const pretty = '{\n  "Results": [\n    {"x": 1}\n  ]\n}';

  expect(parseFramedReport(frame(pretty))).toEqual({ ok: true, body: pretty });
});

describe('refusals', () => {
  test('no markers at all', () => {
    const result = parseFramedReport('scanner crashed\nsegmentation fault\n');

    expect(result).toMatchObject({ ok: false });
    expect((result as { reason: string }).reason).toMatch(/no report marker/);
  });

  test('opening marker without a trailer is reported as truncation', () => {
    // Log rotation dropping the tail. The body in hand is a PREFIX of the real
    // report, and parsing it would present a partial scan as a complete one.
    const clipped = `${BEGIN_MARKER}\n{"Results":[{"Vulnerabi`;
    const result = parseFramedReport(clipped);

    expect(result).toMatchObject({ ok: false });
    expect((result as { reason: string }).reason).toMatch(/truncated/);
  });

  test('a size mismatch is refused even though the frame is complete', () => {
    const result = parseFramedReport(frame(REPORT, { size: 9999 }));

    expect(result).toMatchObject({ ok: false });
    expect((result as { reason: string }).reason).toMatch(/size mismatch/);
  });

  test('a digest mismatch at the same length is refused', () => {
    // Same byte count, different content: mangling rather than clipping, which
    // a length check alone would wave through.
    const tampered = frame(REPORT).replace('"Results"', '"resultS"');
    const result = parseFramedReport(tampered);

    expect(result).toMatchObject({ ok: false });
    expect((result as { reason: string }).reason).toMatch(/digest mismatch/);
  });

  test('a malformed trailer is refused rather than coerced', () => {
    const result = parseFramedReport(`${BEGIN_MARKER}\n${REPORT}\n${END_MARKER}:not-a-number:\n`);

    expect(result).toMatchObject({ ok: false });
    expect((result as { reason: string }).reason).toMatch(/malformed/);
  });

  test('an empty report is still verified rather than assumed fine', () => {
    // "no vulnerabilities" and "the scanner wrote nothing" must not look alike.
    expect(parseFramedReport(frame(''))).toEqual({ ok: true, body: '' });
    expect(parseFramedReport(frame('', { size: 5 }))).toMatchObject({ ok: false });
  });
});

describe('the emitter and the parser stay in step', () => {
  test('the command references the same markers the parser looks for', () => {
    const cmd = emitReportCommand('/workspace/report.json');

    expect(cmd).toContain(BEGIN_MARKER);
    expect(cmd).toContain(END_MARKER);
    expect(cmd).toContain('sha256sum');
    expect(cmd).toContain('wc -c');
  });

  test('output shaped the way the command produces it round-trips', () => {
    // Mirrors `echo BEGIN; cat file; echo ""; echo END:<bytes>:<sha>` for a
    // report file with no trailing newline of its own.
    const bytes = Buffer.byteLength(REPORT, 'utf8');
    const sha = createHash('sha256').update(REPORT).digest('hex');
    const asShellWouldEmit = `${BEGIN_MARKER}\n${REPORT}\n${END_MARKER}:${bytes}:${sha}\n`;

    expect(parseFramedReport(asShellWouldEmit)).toEqual({ ok: true, body: REPORT });
  });

  test('a report file that ends with a newline round-trips exactly', () => {
    // The shape every real scanner produces — trivy and semgrep both terminate
    // their JSON with a newline. `wc -c` counts that byte, so the parser has to
    // return it. This was off by one until a cluster run caught it: the fixture
    // used everywhere else was written without a trailing newline, so the
    // separator the parser strips and the byte the digest covered happened to
    // be the same character.
    const withNewline = `${REPORT}\n`;
    const bytes = Buffer.byteLength(withNewline, 'utf8');
    const sha = createHash('sha256').update(withNewline).digest('hex');
    const asShellWouldEmit = `${BEGIN_MARKER}\n${withNewline}\n${END_MARKER}:${bytes}:${sha}\n`;

    expect(parseFramedReport(asShellWouldEmit)).toEqual({ ok: true, body: withNewline });
  });

  test('the command emits a separator newline unconditionally', () => {
    // The whole fix. Without it the frame is off by one for exactly the reports
    // that matter, and nothing in the unit tests would notice.
    expect(emitReportCommand('/workspace/report.json'))
      .toMatch(/cat \/workspace\/report\.json; echo ""/);
  });
});
