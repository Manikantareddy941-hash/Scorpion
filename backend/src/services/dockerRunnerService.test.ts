/**
 * dockerRunnerService: ephemeral container execution with dockerode fully
 * mocked — image pull gating, multiplex-header log sanitization, exit-code
 * propagation, guaranteed teardown even when the run fails.
 */
import { PassThrough } from 'stream';

const mockContainer = {
  attach: jest.fn(),
  start: jest.fn(),
  wait: jest.fn(),
  remove: jest.fn(),
};
const mockDocker = {
  pull: jest.fn(),
  createContainer: jest.fn(),
  modem: { followProgress: jest.fn() },
};

jest.mock('dockerode', () => jest.fn(() => mockDocker));

import { dockerRunnerService } from './dockerRunnerService';

const makeLogger = () => {
  const lines: string[] = [];
  return { lines, log: (m: string) => lines.push(m) };
};

const armHappyPath = (exitCode = 0) => {
  mockDocker.pull.mockImplementation((_img: string, _opts: unknown, cb: (e: null, s: unknown) => void) => cb(null, {}));
  mockDocker.modem.followProgress.mockImplementation((_s: unknown, done: (e: null) => void) => done(null));
  mockDocker.createContainer.mockResolvedValue(mockContainer);
  mockContainer.attach.mockResolvedValue(new PassThrough());
  mockContainer.start.mockResolvedValue(undefined);
  mockContainer.wait.mockResolvedValue({ StatusCode: exitCode });
  mockContainer.remove.mockResolvedValue(undefined);
};

beforeEach(() => jest.clearAllMocks());

describe('runInContainer', () => {
  it('runs the payload and returns the container exit code', async () => {
    armHappyPath(0);
    const logger = makeLogger();

    const result = await dockerRunnerService.runInContainer({
      image: 'node:24-alpine',
      cmd: ['npm', 'test'],
      workspacePath: '/tmp/ws',
      logger,
    });

    expect(result).toEqual({ exitCode: 0 });
    expect(mockContainer.start).toHaveBeenCalled();
    expect(mockContainer.remove).toHaveBeenCalled(); // teardown always happens
    expect(logger.lines.join('\n')).toContain('status code: 0');
  });

  it('propagates non-zero exit codes instead of throwing', async () => {
    armHappyPath(2);
    expect(await dockerRunnerService.runInContainer({
      image: 'alpine', cmd: ['false'], workspacePath: '/tmp/ws', logger: makeLogger(),
    })).toEqual({ exitCode: 2 });
  });

  it('passes env and entrypoint through to container creation, binds the workspace', async () => {
    armHappyPath();
    await dockerRunnerService.runInContainer({
      image: 'alpine', cmd: ['sh'], workspacePath: '/tmp/ws', logger: makeLogger(),
      env: ['TOKEN=abc'], entrypoint: ['/bin/sh', '-c'],
    });

    expect(mockDocker.createContainer).toHaveBeenCalledWith(expect.objectContaining({
      Env: ['TOKEN=abc'],
      Entrypoint: ['/bin/sh', '-c'],
      WorkingDir: '/workspace',
      HostConfig: expect.objectContaining({ Binds: [expect.stringContaining('/workspace')] }),
    }));
  });

  it('strips the 8-byte docker multiplex header and control bytes from logs', async () => {
    armHappyPath();
    const stream = new PassThrough();
    mockContainer.attach.mockResolvedValue(stream);
    const logger = makeLogger();

    const run = dockerRunnerService.runInContainer({
      image: 'alpine', cmd: ['sh'], workspacePath: '/tmp/ws', logger,
    });
    // stdout frame: type=1 multiplex header + payload wrapped in control bytes
    const payload = Buffer.from('\x1bbuild ok\x07');
    const header = Buffer.from([1, 0, 0, 0, 0, 0, 0, payload.length]);
    stream.write(Buffer.concat([header, payload]));
    stream.end();
    await run;
    // pipe delivery is async relative to container.wait - let it flush
    await new Promise((r) => setImmediate(r));

    expect(logger.lines).toContain('build ok'); // header + ESC/BEL bytes gone
  });

  it('rethrows creation failures but still reports them to the pipeline log', async () => {
    mockDocker.pull.mockImplementation((_i: string, _o: unknown, cb: (e: null, s: unknown) => void) => cb(null, {}));
    mockDocker.modem.followProgress.mockImplementation((_s: unknown, done: (e: null) => void) => done(null));
    mockDocker.createContainer.mockRejectedValue(new Error('no docker daemon'));
    const logger = makeLogger();

    await expect(dockerRunnerService.runInContainer({
      image: 'alpine', cmd: ['sh'], workspacePath: '/tmp/ws', logger,
    })).rejects.toThrow('no docker daemon');
    expect(logger.lines.join('\n')).toContain('no docker daemon');
  });

  it('rejects when the image pull fails', async () => {
    mockDocker.pull.mockImplementation((_i: string, _o: unknown, cb: (e: Error) => void) => cb(new Error('pull denied')));

    await expect(dockerRunnerService.runInContainer({
      image: 'private/img', cmd: ['sh'], workspacePath: '/tmp/ws', logger: makeLogger(),
    })).rejects.toThrow('pull denied');
  });

  it('swallows teardown failures after a successful run', async () => {
    armHappyPath();
    mockContainer.remove.mockRejectedValue(new Error('already gone'));
    const logger = makeLogger();

    const result = await dockerRunnerService.runInContainer({
      image: 'alpine', cmd: ['sh'], workspacePath: '/tmp/ws', logger,
    });

    expect(result.exitCode).toBe(0);
    expect(logger.lines.join('\n')).toContain('teardown structural latency');
  });
});
