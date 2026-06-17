import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./appwrite', () => ({
  account: { get: vi.fn() },
}));

import { authHealthCheck } from './authHealthCheck';
import { account } from './appwrite';

describe('authHealthCheck', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('reports both reachable when the backend responds ok and a session exists', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'ok' }),
    }));
    (account.get as ReturnType<typeof vi.fn>).mockResolvedValue({ $id: 'user-1' });

    const result = await authHealthCheck();

    expect(result).toEqual({ backendReachable: true, appwriteReachable: true });
  });

  it('treats a 401 from Appwrite as reachable (no session, but server responded)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'ok' }),
    }));
    (account.get as ReturnType<typeof vi.fn>).mockRejectedValue({ code: 401 });

    const result = await authHealthCheck();

    expect(result.appwriteReachable).toBe(true);
    expect(result.errorType).toBeUndefined();
  });

  it('marks the backend unreachable and sets NETWORK error when fetch throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('connection refused')));
    (account.get as ReturnType<typeof vi.fn>).mockResolvedValue({ $id: 'user-1' });

    const result = await authHealthCheck();

    expect(result.backendReachable).toBe(false);
    expect(result.errorType).toBe('NETWORK');
  });

  it('escalates to DNS_BLOCK when the backend is up but Appwrite is not reachable at all', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'ok' }),
    }));
    (account.get as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('blocked'));

    const result = await authHealthCheck();

    expect(result.backendReachable).toBe(true);
    expect(result.appwriteReachable).toBe(false);
    expect(result.errorType).toBe('DNS_BLOCK');
  });
});
