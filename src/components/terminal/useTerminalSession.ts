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

    /** The only network call in the terminal; every keyboard feature is local. */
    const run = useCallback(async (paneId: string, command: string) => {
        const commandId = nextCommandId;
        nextCommandId += 1;

        append(paneId, [{ kind: 'input', text: command, commandId }]);
        patchPane(paneId, (p) => ({ ...p, busy: true, history: [...p.history, command] }));

        try {
            const token = await getJWT();
            const res = await fetch('/api/terminal/exec', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify({ command }),
            });
            const payload = await res.json().catch(() => ({}));

            if (!res.ok) {
                append(paneId, [{ kind: 'error', text: payload.error ?? `Request failed (${res.status})` }]);
                return;
            }
            const lines: string[] = Array.isArray(payload.lines) ? payload.lines : [];
            append(paneId, lines.map((text) => ({ kind: 'output' as const, text })));
        } catch (err) {
            // Surfaced rather than swallowed: a terminal that silently drops a
            // command is worse than one that says it failed.
            append(paneId, [{
                kind: 'error',
                text: err instanceof Error ? `error: ${err.message}` : 'error: request failed',
            }]);
        } finally {
            patchPane(paneId, (p) => ({ ...p, busy: false }));
        }
    }, [append, getJWT, patchPane]);

    /** Clears the screen, not the history — matches every real terminal's `clear`. */
    const clearPane = useCallback((paneId: string) => {
        patchPane(paneId, (p) => ({
            ...p,
            entries: [{ kind: 'notice', text: 'Screen cleared — command history retained.' }, { kind: 'output', text: '' }],
        }));
    }, [patchPane]);

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

    return {
        panes, tabs, activeTab, activeTabId,
        setActiveTabId, focusPane,
        run, clearPane, addTab, splitActiveTab, closePane, closeTab,
    };
}
