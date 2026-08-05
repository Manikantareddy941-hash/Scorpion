/**
 * Scorpion Terminal — shared shapes.
 *
 * The terminal is a client over a fixed verb registry, not a shell. Everything
 * here is presentation state: panes, tabs, scrollback. No part of this layer can
 * cause execution — it posts a string to /api/terminal/exec and renders what
 * comes back. See backend/src/services/terminal/commands.ts for why that matters.
 */

export type EntryKind = 'input' | 'output' | 'error' | 'notice';

export interface Entry {
    kind: EntryKind;
    text: string;
    /**
     * Present on `input` entries only. Command-boundary navigation (Ctrl+Up /
     * Ctrl+Down) walks these, so they need a stable identity that survives the
     * scrollback being trimmed.
     */
    commandId?: number;
}

/** One independent terminal session: its own scrollback, history and prompt. */
export interface PaneState {
    id: string;
    entries: Entry[];
    history: string[];
    busy: boolean;
}

/** A tab holds one or more panes; more than one means the tab is split. */
export interface TabState {
    id: string;
    title: string;
    paneIds: string[];
    activePaneId: string;
}

/** A verb as advertised by GET /api/terminal/commands. */
export interface CommandInfo {
    name: string;
    summary: string;
    usage: string;
}

export const MAX_SCROLLBACK = 500;

export const BANNER: readonly Entry[] = [
    { kind: 'output', text: 'Scorpion Terminal — audited command surface.' },
    { kind: 'output', text: "Type 'help' for available commands." },
    { kind: 'output', text: '' },
];

let paneCounter = 0;
let tabCounter = 0;

export function newPane(): PaneState {
    paneCounter += 1;
    return { id: `pane-${paneCounter}`, entries: [...BANNER], history: [], busy: false };
}

export function newTab(paneId: string): TabState {
    tabCounter += 1;
    return { id: `tab-${tabCounter}`, title: `scorpion ${tabCounter}`, paneIds: [paneId], activePaneId: paneId };
}
