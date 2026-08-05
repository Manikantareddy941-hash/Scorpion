import { useState, useRef, useEffect, type KeyboardEvent } from 'react';
import { Mic, MicOff, X } from 'lucide-react';
import type { Entry, PaneState } from './types';
import { useDictation } from './useDictation';

/**
 * One terminal pane.
 *
 * Output is rendered as React text nodes — never dangerouslySetInnerHTML — so a
 * line echoed back from the server cannot inject markup. That is the whole reason
 * this is not xterm.js: with a fixed verb table there is no ANSI, no cursor
 * addressing and no raw mode to emulate, so a terminal emulator would be ~300KB
 * of parser guarding against escape sequences we never emit.
 */

type Props = {
    pane: PaneState;
    isFocused: boolean;
    canClose: boolean;
    onFocus: () => void;
    onRun: (command: string) => void;
    onClear: () => void;
    onClose: () => void;
    onOpenRecent: () => void;
};

const colorFor = (kind: Entry['kind']): string => {
    if (kind === 'error') return 'var(--accent-danger, #f87171)';
    if (kind === 'input') return 'var(--accent-primary)';
    if (kind === 'notice') return 'var(--text-muted)';
    return 'var(--text-secondary)';
};

export function TerminalPane({ pane, isFocused, canClose, onFocus, onRun, onClear, onClose, onOpenRecent }: Props) {
    const [input, setInput] = useState('');
    const [historyIndex, setHistoryIndex] = useState(-1);
    /** Index into the pane's command boundaries for Ctrl+Up / Ctrl+Down. */
    const [boundaryIndex, setBoundaryIndex] = useState(-1);

    const scrollRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    const dictation = useDictation((transcript) => setInput((cur) => (cur ? `${cur} ${transcript}` : transcript)));

    const commandIds = pane.entries.filter((e) => e.kind === 'input').map((e) => e.commandId ?? -1);

    useEffect(() => {
        scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
    }, [pane.entries]);

    useEffect(() => {
        if (isFocused) inputRef.current?.focus();
    }, [isFocused]);

    /** Scrolls the nth command into view rather than moving the caret. */
    const scrollToBoundary = (index: number) => {
        const id = commandIds[index];
        if (id === undefined) return;
        const el = scrollRef.current?.querySelector<HTMLElement>(`[data-command-id="${id}"]`);
        el?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    };

    const recallHistory = (direction: 1 | -1) => {
        if (pane.history.length === 0) return;
        const next = direction === 1
            ? Math.min(historyIndex + 1, pane.history.length - 1)
            : historyIndex - 1;
        setHistoryIndex(next);
        setInput(next < 0 ? '' : pane.history[pane.history.length - 1 - next]);
    };

    const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
        // Ctrl+Up / Ctrl+Down — walk command boundaries in the scrollback.
        if (e.ctrlKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
            e.preventDefault();
            if (commandIds.length === 0) return;
            const start = boundaryIndex === -1 ? commandIds.length : boundaryIndex;
            const next = e.key === 'ArrowUp'
                ? Math.max(0, start - 1)
                : Math.min(commandIds.length - 1, start + 1);
            setBoundaryIndex(next);
            scrollToBoundary(next);
            return;
        }

        // Ctrl+Alt+R — recent command picker.
        if (e.ctrlKey && e.altKey && (e.key === 'r' || e.key === 'R')) {
            e.preventDefault();
            onOpenRecent();
            return;
        }

        // Ctrl+L — clear screen, the standard binding.
        if (e.ctrlKey && (e.key === 'l' || e.key === 'L')) {
            e.preventDefault();
            onClear();
            return;
        }

        if (e.key === 'Enter' && !pane.busy) {
            const command = input.trim();
            setInput('');
            setHistoryIndex(-1);
            setBoundaryIndex(-1);
            if (command) onRun(command);
            return;
        }

        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            recallHistory(e.key === 'ArrowUp' ? 1 : -1);
        }
    };

    return (
        <div
            onMouseDown={onFocus}
            className="flex flex-col min-h-0 flex-1 rounded-lg overflow-hidden"
            style={{
                background: 'var(--bg-card)',
                border: `1px solid ${isFocused ? 'var(--accent-primary)' : 'var(--border-subtle)'}`,
            }}
        >
            <div
                className="flex items-center justify-between px-2 py-1 shrink-0 text-[10px] uppercase tracking-widest"
                style={{ borderBottom: '1px solid var(--border-subtle)', color: 'var(--text-muted)' }}
            >
                <span>{pane.id}{pane.busy ? ' · running' : ''}</span>
                <div className="flex items-center gap-1">
                    <button
                        type="button"
                        onClick={dictation.supported ? dictation.toggle : undefined}
                        disabled={!dictation.supported}
                        title={dictation.supported ? 'Start dictation' : 'Dictation unsupported in this browser'}
                        aria-label="Toggle dictation"
                        className="p-1 rounded disabled:opacity-30"
                        style={{ color: dictation.listening ? 'var(--accent-primary)' : 'var(--text-muted)' }}
                    >
                        {dictation.listening ? <Mic size={12} /> : <MicOff size={12} />}
                    </button>
                    {canClose && (
                        <button type="button" onClick={onClose} aria-label="Close pane" title="Close pane" className="p-1 rounded" style={{ color: 'var(--text-muted)' }}>
                            <X size={12} />
                        </button>
                    )}
                </div>
            </div>

            <div
                ref={scrollRef}
                onClick={() => inputRef.current?.focus()}
                className="flex-1 min-h-0 overflow-y-auto p-3 font-mono text-xs leading-relaxed"
            >
                {pane.entries.map((entry, i) => (
                    <div
                        key={i}
                        data-command-id={entry.commandId}
                        className="whitespace-pre-wrap break-words"
                        style={{ color: colorFor(entry.kind) }}
                    >
                        {entry.kind === 'input' ? `scorpion> ${entry.text}` : entry.text}
                    </div>
                ))}

                <div className="flex items-center gap-2 mt-1">
                    <span style={{ color: 'var(--accent-primary)' }} className="font-mono text-xs shrink-0">scorpion&gt;</span>
                    <input
                        ref={inputRef}
                        value={input}
                        disabled={pane.busy}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={onKeyDown}
                        aria-label="Terminal command input"
                        autoComplete="off"
                        spellCheck={false}
                        className="flex-1 bg-transparent outline-none font-mono text-xs"
                        style={{ color: 'var(--text-primary)' }}
                    />
                </div>
            </div>
        </div>
    );
}
