import { createHash } from 'crypto';

/**
 * Extracts a scanner report from container stdout.
 *
 * The report comes back through `pods/log` rather than a shared volume, which
 * keeps the runner's egress at zero. The cost is that the report shares a
 * channel with progress output, and the kubelet rotates container logs (10Mi by
 * default) — so a large report can arrive clipped.
 *
 * Silently parsing a clipped report is the failure this framing exists to
 * prevent. The trailer carries the byte count and digest the workload computed,
 * both are checked, and a mismatch reports `degraded` instead of handing back a
 * half-report that looks like a clean scan.
 */

export const BEGIN_MARKER = '---SCORPION-REPORT-BEGIN---';
export const END_MARKER = '---SCORPION-REPORT-END---';

export type FramedReport =
  | { ok: true; body: string }
  | { ok: false; reason: string };

/**
 * Shell fragment a workload appends to emit `file` in the expected frame.
 *
 * Lives here so the producer and the parser cannot drift: if the trailer format
 * changes, both sides change in one edit.
 */
export function emitReportCommand(file: string): string {
  return [
    `echo '${BEGIN_MARKER}'`,
    `cat ${file}`,
    `echo "${END_MARKER}:$(wc -c <${file} | tr -d ' '):$(sha256sum ${file} | cut -d' ' -f1)"`,
  ].join('; ');
}

export function parseFramedReport(stdout: string): FramedReport {
  const begin = stdout.indexOf(BEGIN_MARKER);
  if (begin === -1) {
    return { ok: false, reason: 'no report marker in output — the scanner produced nothing to parse' };
  }

  const endIdx = stdout.indexOf(END_MARKER, begin);
  if (endIdx === -1) {
    // The opening marker arrived and the closing one did not. Log rotation
    // dropping the tail is the likely cause, and the body in hand is a prefix
    // of the real report.
    return { ok: false, reason: 'report was truncated before its trailer — output is incomplete' };
  }

  const bodyStart = begin + BEGIN_MARKER.length;
  // Trim exactly one newline on each side rather than all whitespace: the
  // digest was computed over the file, and stripping significant leading or
  // trailing whitespace would fail an otherwise valid report.
  const body = stdout.slice(bodyStart, endIdx).replace(/^\r?\n/, '').replace(/\r?\n$/, '');

  const trailer = stdout.slice(endIdx + END_MARKER.length).split(/\r?\n/)[0];
  const [, sizeRaw, digest] = trailer.split(':');

  const expectedSize = Number(sizeRaw);
  if (!Number.isFinite(expectedSize) || !digest) {
    return { ok: false, reason: `report trailer is malformed: "${trailer.slice(0, 40)}"` };
  }

  const actualSize = Buffer.byteLength(body, 'utf8');
  if (actualSize !== expectedSize) {
    return { ok: false, reason: `report size mismatch: workload wrote ${expectedSize} bytes, ${actualSize} arrived` };
  }

  const actualDigest = createHash('sha256').update(body, 'utf8').digest('hex');
  if (actualDigest !== digest) {
    // Same length, different content: log mangling rather than clipping.
    return { ok: false, reason: 'report digest mismatch — the content was altered in transit' };
  }

  return { ok: true, body };
}
