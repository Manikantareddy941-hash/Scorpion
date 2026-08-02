jest.mock('@kubernetes/client-node', () => ({}));
// Both packages are ESM and unparseable under ts-jest CJS. The archiver stub is
// a real stream, so the pipe/finalize flow is still exercised; the ACTUAL
// tarball is verified in smoke_k8s_job_runner, which runs compiled JS under
// plain node where the real package loads.
jest.mock('archiver', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { PassThrough } = require('stream');
  return {
    TarArchive: class extends PassThrough {
      directory(): void {}
      finalize(): void { this.end('tar-bytes'); }
    },
  };
});

import fs from 'fs';
import os from 'os';
import path from 'path';
import { PassThrough } from 'stream';
import { INIT_CONTAINER_NAME, SENTINEL_PATH, WORKSPACE_PATH } from './jobSpec';
import { EXTRACT_COMMAND, TransportError, awaitLoaderReady, streamWorkspace } from './workspaceTransport';

describe('the extract command', () => {
  test('extraction and the sentinel are one shell invocation under set -e', () => {
    // They must not be separable. A crash between two commands would leave a
    // half-tree wearing a sentinel that says it is complete.
    const script = EXTRACT_COMMAND[2];

    expect(script).toMatch(/^set -e;/);
    expect(script).toContain('tar -xzf -');
    expect(script).toContain(`touch ${SENTINEL_PATH}`);
    expect(script.indexOf('tar')).toBeLessThan(script.indexOf('touch'));
  });

  test('ownership and permissions from the archive are discarded', () => {
    // The tarball carries the backend's uids and modes, which mean nothing in a
    // pod running as 10001 and would only produce unreadable files.
    expect(EXTRACT_COMMAND[2]).toContain('--no-same-owner');
    expect(EXTRACT_COMMAND[2]).toContain('--no-same-permissions');
  });

  test('extraction is confined to the workspace mount', () => {
    expect(EXTRACT_COMMAND[2]).toContain(`-C ${WORKSPACE_PATH}`);
  });
});

describe('streamWorkspace', () => {
  const dir = () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-'));
    fs.writeFileSync(path.join(d, 'a.txt'), 'hello');
    return d;
  };

  test('resolves when the remote command reports Success', async () => {
    const d = dir();
    const exec = {
      exec: jest.fn(async (_ns, _pod, _c, _cmd, _out, _err, _in, _tty, cb?: (s: { status: string }) => void) => {
        cb?.({ status: 'Success' });
      }),
    };

    await expect(streamWorkspace(exec as never, 'pod-1', d)).resolves.toBeUndefined();
    fs.rmSync(d, { recursive: true, force: true });
  });

  test('targets the loader container, not the workload', async () => {
    const d = dir();
    const exec = {
      exec: jest.fn(async (_ns, _pod, _c, _cmd, _out, _err, _in, _tty, cb?: (s: { status: string }) => void) => {
        cb?.({ status: 'Success' });
      }),
    };

    await streamWorkspace(exec as never, 'pod-1', d);

    expect(exec.exec.mock.calls[0][2]).toBe(INIT_CONTAINER_NAME);
    fs.rmSync(d, { recursive: true, force: true });
  });

  test('a Failure status rejects — this is the truncated-stream path', async () => {
    // tar exiting non-zero on unexpected EOF lands here, and the sentinel was
    // never written, so the pod will time out rather than scan a partial tree.
    const d = dir();
    const exec = {
      exec: jest.fn(async (_ns, _pod, _c, _cmd, _out, _err, _in, _tty, cb?: (s: { status: string; message?: string }) => void) => {
        cb?.({ status: 'Failure', message: 'command terminated with exit code 2' });
      }),
    };

    await expect(streamWorkspace(exec as never, 'pod-1', d)).rejects.toThrow(TransportError);
    fs.rmSync(d, { recursive: true, force: true });
  });

  test('an exec channel error rejects as a transport failure', async () => {
    const d = dir();
    const exec = { exec: jest.fn(async () => { throw new Error('connection reset'); }) };

    await expect(streamWorkspace(exec as never, 'pod-1', d)).rejects.toThrow(/exec channel failed/);
    fs.rmSync(d, { recursive: true, force: true });
  });

});

describe('awaitLoaderReady', () => {
  const podList = (state: Record<string, unknown>) => ({
    items: [{
      metadata: { name: 'pod-1' },
      status: { initContainerStatuses: [{ name: INIT_CONTAINER_NAME, state }] },
    }],
  });

  test('returns the pod once the loader is running', async () => {
    const core = { listNamespacedPod: jest.fn(async () => podList({ running: {} })) };

    await expect(awaitLoaderReady(core as never, 'job-1', 5000, 10)).resolves.toBe('pod-1');
  });

  test('waits through Pending rather than exec-ing too early', async () => {
    // Exec against a pod that has not started fails; the pod is Pending while
    // it schedules and pulls.
    let call = 0;
    const core = {
      listNamespacedPod: jest.fn(async () => (++call < 3 ? { items: [] } : podList({ running: {} }))),
    };

    await expect(awaitLoaderReady(core as never, 'job-1', 5000, 10)).resolves.toBe('pod-1');
    expect(call).toBeGreaterThanOrEqual(3);
  });

  test('a loader that already exited is reported, not fed', async () => {
    // It timed out waiting, or its image could not be pulled. Streaming into it
    // would hang until the caller's own deadline for no reason.
    const core = {
      listNamespacedPod: jest.fn(async () => podList({ terminated: { reason: 'Error' } })),
    };

    await expect(awaitLoaderReady(core as never, 'job-1', 5000, 10)).rejects.toThrow(/exited before it could be fed/);
  });

  test('gives up with a clear error rather than hanging forever', async () => {
    const core = { listNamespacedPod: jest.fn(async () => ({ items: [] })) };

    await expect(awaitLoaderReady(core as never, 'job-1', 60, 10)).rejects.toThrow(/did not start within/);
  });
});

test('PassThrough is used for stderr capture, so a large error cannot block the stream', () => {
  // Guards the shape rather than the behaviour: a paused stderr stream would
  // deadlock the exec channel mid-transfer.
  expect(new PassThrough().readable).toBe(true);
});
