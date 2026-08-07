import { useCallback, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { MAX_SCROLLBACK, newPane, newTab, type Entry, type PaneState, type TabState } from './types';

/**
 * Owns every pane and tab for the terminal view.
 *
 * Pane state is a flat map keyed by id, with tabs holding only id references.
 * That split matters: splitting, closing and tab-switching then rearrange
 * references without unmounting a pane, so scrollback survives being moved.
 */

/** Monotonic across all panes; anchors command-boundary scrolling. */
let nextCommandId = 1;

/**
 * Serviced in the client rather than over the wire. Clearing the screen changes no
 * server state and needs no audit record, so it is the one thing that must keep
 * working when the audited backend is unreachable.
 */
const LOCAL_ONLY = 'clear';

/** How much of a proxy's error page to echo. Enough to identify it, not to fill the pane. */
const UPSTREAM_SNIPPET = 160;

/**
 * A response body that is not JSON did not come from /api/terminal/exec — the route
 * only ever answers JSON. Something in front of it answered instead: nginx with a 502
 * because the backend container is down, the dev proxy with a 500, or the SPA fallback
 * with index.html because /api was never proxied at all.
 *
 * `Request failed (502)` hid all of that behind a number. An operator needs to know the
 * command never reached the audit ledger, and which hop to go look at.
 */
function transportTrace(status: number, body: string): readonly Entry[] {
    const snippet = body.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, UPSTREAM_SNIPPET);
    return [
        { kind: 'error', text: `error: the audited backend never answered (HTTP ${status}).` },
        { kind: 'error', text: '  a proxy replied instead of /api/terminal/exec — the command did not run and was not audited.' },
        ...(snippet ? [{ kind: 'error' as const, text: `  upstream: ${snippet}` }] : []),
        { kind: 'notice', text: '  check the backend on :3001 (docker compose ps backend), then re-run.' },
    ];
}

export function useTerminalSession() {
    const { getJWT } = useAuth();

    const [panes, setPanes] = useState<Record<string, PaneState>>(() => {
        const first = newPane();
        return { [first.id]: first };
    });
    const [tabs, setTabs] = useState<TabState[]>(() => {
        const onlyPaneId = Object.keys(panes)[0];
        return [newTab(onlyPaneId)];
    });
    const [activeTabId, setActiveTabId] = useState<string>(() => tabs[0].id);

    const activeTab = tabs.find((t) => t.id === activeTabId) ?? tabs[0];

    const patchPane = useCallback((paneId: string, patch: (p: PaneState) => PaneState) => {
        setPanes((prev) => (prev[paneId] ? { ...prev, [paneId]: patch(prev[paneId]) } : prev));
    }, []);

    const append = useCallback((paneId: string, next: readonly Entry[]) => {
        patchPane(paneId, (p) => ({ ...p, entries: [...p.entries, ...next].slice(-MAX_SCROLLBACK) }));
    }, [patchPane]);

    /** Clears the screen, not the history — matches every real terminal's `clear`. */
    const clearPane = useCallback((paneId: string) => {
        patchPane(paneId, (p) => ({
            ...p,
            entries: [{ kind: 'notice', text: 'Screen cleared — command history retained.' }, { kind: 'output', text: '' }],
        }));
    }, [patchPane]);

    /** The only network call in the terminal; every keyboard feature is local. */
    const run = useCallback(async (paneId: string, command: string) => {
        const commandId = nextCommandId;
        nextCommandId += 1;

        append(paneId, [{ kind: 'input', text: command, commandId }]);
        patchPane(paneId, (p) => ({ ...p, history: [...p.history, command] }));

        if (command.trim() === LOCAL_ONLY) {
            clearPane(paneId);
            return;
        }

        patchPane(paneId, (p) => ({ ...p, busy: true }));

        try {
            const token = await getJWT();
            const res = await fetch('/api/terminal/exec', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify({ command }),
            });

            // Read as text first. Parsing straight to JSON conflated "the route rejected
            // this command" with "nothing reached the route", and printed the same
            // unhelpful line for both.
            const body = await res.text();
            let payload: { error?: string; lines?: unknown } | null = null;
            try {
                payload = JSON.parse(body) as { error?: string; lines?: unknown };
            } catch {
                payload = null;
            }

            if (payload === null) {
                append(paneId, transportTrace(res.status, body));
                return;
            }
            if (!res.ok) {
                append(paneId, [{ kind: 'error', text: payload.error ?? `Request failed (${res.status})` }]);
                return;
            }
            const lines: string[] = Array.isArray(payload.lines) ? payload.lines : [];
            append(paneId, lines.map((text) => ({ kind: 'output' as const, text })));
        } catch (err) {
            // Surfaced rather than swallowed: a terminal that silently drops a
            // command is worse than one that says it failed. A throw here means the
            // request never completed at all — DNS, TLS, or a proxy that closed.
            append(paneId, [
                {
                    kind: 'error',
                    text: `error: could not reach /api/terminal/exec — ${err instanceof Error ? err.message : 'network failure'}`,
                },
                { kind: 'notice', text: '  the command did not run and was not audited. Nothing is queued for retry.' },
            ]);
        } finally {
            patchPane(paneId, (p) => ({ ...p, busy: false }));
        }
    }, [append, clearPane, getJWT, patchPane]);

    const addTab = useCallback(() => {
        const pane = newPane();
        const tab = newTab(pane.id);
        setPanes((prev) => ({ ...prev, [pane.id]: pane }));
        setTabs((prev) => [...prev, tab]);
        setActiveTabId(tab.id);
    }, []);

    /** Adds a pane beside the active one, within the current tab. */
    const splitActiveTab = useCallback(() => {
        const pane = newPane();
        setPanes((prev) => ({ ...prev, [pane.id]: pane }));
        setTabs((prev) => prev.map((t) => (
            t.id === activeTabId
                ? { ...t, paneIds: [...t.paneIds, pane.id], activePaneId: pane.id }
                : t
        )));
    }, [activeTabId]);

    const focusPane = useCallback((tabId: string, paneId: string) => {
        setTabs((prev) => prev.map((t) => (t.id === tabId ? { ...t, activePaneId: paneId } : t)));
    }, []);

    /**
     * Closing the last pane in a tab closes the tab. Closing the last tab leaves
     * a fresh one rather than an empty view — an empty terminal screen reads as
     * broken rather than as deliberate.
     */
    const closePane = useCallback((tabId: string, paneId: string) => {
        setTabs((prev) => {
            const next: TabState[] = [];
            for (const t of prev) {
                if (t.id !== tabId) { next.push(t); continue; }
                const remaining = t.paneIds.filter((id) => id !== paneId);
                if (remaining.length > 0) {
                    next.push({ ...t, paneIds: remaining, activePaneId: remaining[remaining.length - 1] });
                }
            }
            if (next.length > 0) {
                setActiveTabId((cur) => (next.some((t) => t.id === cur) ? cur : next[next.length - 1].id));
                return next;
            }
            const pane = newPane();
            const tab = newTab(pane.id);
            setPanes((p) => ({ ...p, [pane.id]: pane }));
            setActiveTabId(tab.id);
            return [tab];
        });
        setPanes((prev) => {
            const { [paneId]: _removed, ...rest } = prev;
            return rest;
        });
    }, []);

    const closeTab = useCallback((tabId: string) => {
        const tab = tabs.find((t) => t.id === tabId);
        if (!tab) return;
        // Reuse closePane so the "last tab leaves a fresh one" rule lives in one place.
        tab.paneIds.forEach((paneId) => closePane(tabId, paneId));
    }, [tabs, closePane]);

    /** Prints into a pane without running anything — used to explain out-of-band actions. */
    const notify = useCallback((paneId: string, lines: readonly string[]) => {
        append(paneId, lines.map((text) => ({ kind: 'notice' as const, text })));
    }, [append]);

    return {
        panes, tabs, activeTab, activeTabId,
        setActiveTabId, focusPane,
        run, clearPane, addTab, splitActiveTab, closePane, closeTab, notify,
    };
}
