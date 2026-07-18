import type { Request, Response, NextFunction } from 'express';
import { verifyIdeAccess } from './ideRoutes';

jest.mock('../lib/appwrite', () => ({
  databases: { createDocument: jest.fn() },
  DB_ID: 'db', COLLECTIONS: { SCANS: 'scans' }, ID: { unique: () => 'id1' },
}));
jest.mock('../scanners/pipeline', () => ({ runScanPipeline: jest.fn() }));

type MockRes = Response & { statusCode?: number; body?: unknown };

function mockReq(opts: { peer?: string; headers?: Record<string, string> } = {}): Request {
  return {
    socket: { remoteAddress: opts.peer ?? '127.0.0.1' },
    headers: opts.headers ?? {},
    // Header-derived fields an attacker controls; the guard must ignore them.
    ip: '127.0.0.1',
    hostname: 'localhost',
  } as unknown as Request;
}

function mockRes(): MockRes {
  const res = {} as MockRes;
  res.status = jest.fn((code: number) => { res.statusCode = code; return res; }) as never;
  res.json = jest.fn((body: unknown) => { res.body = body; return res; }) as never;
  return res;
}

describe('verifyIdeAccess', () => {
  const env = { ...process.env };
  afterEach(() => { process.env = { ...env }; });

  describe('development (no secret configured)', () => {
    beforeEach(() => {
      delete process.env.IDE_SCAN_SECRET;
      process.env.NODE_ENV = 'development';
    });

    it('allows a genuine loopback client', () => {
      const next = jest.fn() as NextFunction;
      verifyIdeAccess(mockReq({ peer: '127.0.0.1' }), mockRes(), next);
      expect(next).toHaveBeenCalled();
    });

    it('rejects a remote peer even when Host and X-Forwarded-For claim localhost', () => {
      // The exact bypass the old gate allowed: req.hostname is the Host header
      // and req.ip honours X-Forwarded-For, so both are attacker-controlled.
      const req = mockReq({
        peer: '203.0.113.9',
        headers: { host: 'localhost', 'x-forwarded-for': '127.0.0.1' },
      });
      const res = mockRes();
      const next = jest.fn() as NextFunction;
      verifyIdeAccess(req, res, next);
      expect(next).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(403);
    });
  });

  describe('production', () => {
    beforeEach(() => { process.env.NODE_ENV = 'production'; });

    it('refuses to serve the route when no secret is configured', () => {
      // Behind a proxy every request looks like loopback, so an unconfigured
      // deployment must fail closed rather than trust the peer address.
      delete process.env.IDE_SCAN_SECRET;
      const res = mockRes();
      const next = jest.fn() as NextFunction;
      verifyIdeAccess(mockReq({ peer: '127.0.0.1' }), res, next);
      expect(next).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(503);
    });

    it('rejects a loopback request carrying no secret', () => {
      process.env.IDE_SCAN_SECRET = 'correct-horse';
      const res = mockRes();
      const next = jest.fn() as NextFunction;
      verifyIdeAccess(mockReq({ peer: '127.0.0.1' }), res, next);
      expect(next).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(401);
    });

    it('rejects a wrong secret', () => {
      process.env.IDE_SCAN_SECRET = 'correct-horse';
      const res = mockRes();
      const next = jest.fn() as NextFunction;
      verifyIdeAccess(mockReq({ headers: { 'x-ide-secret': 'wrong' } }), res, next);
      expect(res.statusCode).toBe(401);
      expect(next).not.toHaveBeenCalled();
    });

    it('accepts the correct secret from any peer', () => {
      process.env.IDE_SCAN_SECRET = 'correct-horse';
      const next = jest.fn() as NextFunction;
      verifyIdeAccess(
        mockReq({ peer: '203.0.113.9', headers: { 'x-ide-secret': 'correct-horse' } }),
        mockRes(),
        next
      );
      expect(next).toHaveBeenCalled();
    });
  });
});
