import { useState, useRef, useEffect, useCallback, type KeyboardEvent } from 'react';
import { Terminal as TerminalIcon } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

/**
 * Scorpion Terminal.
 *
 * Deliberately not xterm.js: this surface has a fixed verb table, so there is no
 * ANSI parsing, cursor addressing, or raw mode to emulate. Output lines are rendered
 * as React text nodes — never dangerouslySetInnerHTML — so a line echoed back from
 * the server cannot inject markup.
 */

interface Entry {
    kind: 'input' | 'output' | 'error';
    text: string;
}

const BANNER: readonly Entry[] = [
    { kind: 'output', text: 'Scorpion Terminal — audited command surface.' },
    { kind: 'output', text: "Type 'help' for available commands." },
    { kind: 'output', text: '' },
];

/** Bounded so a long session can't grow the DOM without limit. */
const MAX_SCROLLBACK = 500;

export default function ScorpionTerminal() {
    const { getJWT } = useAuth();
    const [entries, setEntries] = useState<Entry[]>([...BANNER]);
    const [input, setInput] = useState('');
    const [busy, setBusy] = useState(false);
    const [history, setHistory] = useState<string[]>([]);
    const [historyIndex, setHistoryIndex] = useState(-1);

    const scrollRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
    }, [entries]);

    const append = useCallback((next: readonly Entry[]) => {
        setEntries((prev) => [...prev, ...next].slice(-MAX_SCROLLBACK));
    }, []);

    const run = useCallback(async (command: string) => {
        append([{ kind: 'input', text: command }]);
        setBusy(true);
        try {
            const token = await getJWT();
            const res = await fetch('/api/terminal/exec', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({ command }),
            });

            const payload = await res.json().catch(() => ({}));

            if (!res.ok) {
                append([{ kind: 'error', text: payload.error ?? `Request failed (${res.status})` }]);
                return;
            }
            const lines: string[] = Array.isArray(payload.lines) ? payload.lines : [];
            append(lines.map((text) => ({ kind: 'output' as const, text })));
        } catch (err) {
            // Network/parse failure. Surfaced rather than swallowed — a terminal that
            // silently drops a command is worse than one that says it failed.
            append([{
                kind: 'error',
                text: err instanceof Error ? `error: ${err.message}` : 'error: request failed',
            }]);
        } finally {
            setBusy(false);
        }
    }, [append, getJWT]);

    const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter' && !busy) {
            const command = input.trim();
            setInput('');
            setHistoryIndex(-1);
            if (!command) return;
            setHistory((prev) => [...prev, command]);
            void run(command);
            return;
        }

        // Shell-style history recall. Purely client-side convenience.
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            if (history.length === 0) return;
            const next = e.key === 'ArrowUp'
                ? Math.min(historyIndex + 1, history.length - 1)
                : historyIndex - 1;
            setHistoryIndex(next);
            setInput(next < 0 ? '' : history[history.length - 1 - next]);
        }
    };

    const colorFor = (kind: Entry['kind']) =>
        kind === 'error' ? 'var(--accent-danger, #f87171)'
            : kind === 'input' ? 'var(--accent-primary)'
                : 'var(--text-secondary)';

    return (
        <div className="flex flex-col h-full p-4 gap-3" style={{ background: 'var(--bg-primary)' }}>
            <header className="flex items-center gap-2 shrink-0">
                <TerminalIcon size={16} style={{ color: 'var(--accent-primary)' }} />
                <h1 className="text-sm font-semibold tracking-tight" style={{ color: 'var(--text-primary)' }}>
                    Scorpion Terminal
                </h1>
                <span
                    className="text-[10px] font-medium uppercase tracking-widest px-2 py-0.5 rounded"
                    style={{ background: 'var(--bg-secondary)', color: 'var(--text-muted)' }}
                >
                    Audited
                </span>
            </header>

            <div
                ref={scrollRef}
                onClick={() => inputRef.current?.focus()}
                className="flex-1 min-h-0 overflow-y-auto rounded-lg p-3 font-mono text-xs leading-relaxed"
                style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)' }}
            >
                {entries.map((entry, i) => (
                    <div key={i} className="whitespace-pre-wrap break-words" style={{ color: colorFor(entry.kind) }}>
                        {entry.kind === 'input' ? `scorpion> ${entry.text}` : entry.text}
                    </div>
                ))}

                <div className="flex items-center gap-2 mt-1">
                    <span style={{ color: 'var(--accent-primary)' }} className="font-mono text-xs shrink-0">
                        scorpion&gt;
                    </span>
                    <input
                        ref={inputRef}
                        value={input}
                        disabled={busy}
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
