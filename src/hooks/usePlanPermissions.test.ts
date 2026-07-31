import { describe, expect, test, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const apiFetch = vi.fn();
vi.mock('../lib/apiClient', () => ({ apiFetch: (...args: unknown[]) => apiFetch(...args) }));

import { usePlanPermissions } from './usePlanPermissions';

const respond = (body: unknown, ok = true, status = 200) =>
  apiFetch.mockResolvedValue({ ok, status, json: async () => body });

beforeEach(() => { apiFetch.mockReset(); });

describe('usePlanPermissions', () => {
  test('everything is permitted while the backend is still shadowing', async () => {
    // The trap this guards: in shadow mode the permission list is empty for
    // anyone the backfill has not reached, yet those users still have full
    // access through the legacy check. Honouring the list would blank the UI.
    respond({ permissions: [], enforcing: false });
    const { result } = renderHook(() => usePlanPermissions('p1'));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.can('issue:delete')).toBe(true);
  });

  test('once enforcing, only granted permissions pass', async () => {
    respond({ permissions: ['issue:read', 'epic:read'], enforcing: true });
    const { result } = renderHook(() => usePlanPermissions('p1'));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.can('issue:read')).toBe(true);
    expect(result.current.can('issue:delete')).toBe(false);
  });

  test('an admin wildcard satisfies everything', async () => {
    respond({ permissions: ['*'], enforcing: true });
    const { result } = renderHook(() => usePlanPermissions('p1'));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.can('access:write')).toBe(true);
  });

  test('a failed read leaves the UI usable rather than greying it out', async () => {
    // Data plane fails open on purpose: the server still refuses the action if
    // the user genuinely lacks it, so a read blip must not disable a board.
    apiFetch.mockRejectedValue(new Error('network down'));
    const { result } = renderHook(() => usePlanPermissions('p1'));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeTruthy();
    expect(result.current.can('issue:write')).toBe(true);
  });

  test('no project means no request', async () => {
    renderHook(() => usePlanPermissions(null));
    expect(apiFetch).not.toHaveBeenCalled();
  });
});
