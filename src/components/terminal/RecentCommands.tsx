import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Search } from 'lucide-react';

/**
 * Run Recent Command (Ctrl+Alt+R).
 *
 * Picks from what this pane has already run. It does not offer the full verb
 * table — that is what `help` is for — because a picker seeded with commands the
 * caller has never run turns into a discovery UI, and discovery belongs on a
 * surface that can show each verb's usage and required role.
 */

type Props = {
    history: readonly string[];
    onPick: (command: string) => void;
    onClose: () => void;
};

export function RecentCommands({ history, onPick, onClose }: Props) {
    const [query, setQuery] = useState('');
    const [selected, setSelected] = useState(0);
    const inputRef = useRef<HTMLInputElement>(null);

    // Most recent first, de-duplicated: a command run ten times should occupy one
    // row, at the position of its latest use.
    const items = useMemo(() => {
        const seen = new Set<string>();
        const unique: string[] = [];
        for (let i = history.length - 1; i >= 0; i -= 1) {
            const cmd = history[i];
            if (seen.has(cmd)) continue;
            seen.add(cmd);
            unique.push(cmd);
        }
        const q = query.trim().toLowerCase();
        return q ? unique.filter((c) => c.toLowerCase().includes(q)) : unique;
    }, [history, query]);

    useEffect(() => { inputRef.current?.focus(); }, []);
    useEffect(() => { setSelected(0); }, [query]);

    const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
        if (e.key === 'ArrowDown') { e.preventDefault(); setSelected((s) => Math.min(s + 1, items.length - 1)); return; }
        if (e.key === 'ArrowUp') { e.preventDefault(); setSelected((s) => Math.max(s - 1, 0)); return; }
        if (e.key === 'Enter') {
            e.preventDefault();
            const chosen = items[selected];
            if (chosen) onPick(chosen);
        }
    };

    return (
        <div
            className="fixed inset-0 z-50 flex items-start justify-center pt-24"
            style={{ background: 'rgba(0,0,0,0.5)' }}
            onClick={onClose}
            role="presentation"
        >
            <div
                className="w-full max-w-lg rounded-lg overflow-hidden shadow-2xl"
                style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)' }}
                onClick={(e) => e.stopPropagation()}
                role="dialog"
                aria-label="Run recent command"
            >
                <div className="flex items-center gap-2 px-3 py-2" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                    <Search size={14} style={{ color: 'var(--text-muted)' }} />
                    <input
                        ref={inputRef}
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        onKeyDown={onKeyDown}
                        placeholder="Run recent command…"
                        aria-label="Filter recent commands"
                        className="flex-1 bg-transparent outline-none text-sm font-mono"
                        style={{ color: 'var(--text-primary)' }}
                    />
                </div>

                <div className="max-h-72 overflow-y-auto">
                    {items.length === 0 && (
                        <p className="px-3 py-4 text-xs" style={{ color: 'var(--text-muted)' }}>
                            {history.length === 0 ? 'No commands run in this pane yet.' : 'No match.'}
                        </p>
                    )}
                    {items.map((cmd, i) => (
                        <button
                            key={cmd}
                            type="button"
                            onClick={() => onPick(cmd)}
                            onMouseEnter={() => setSelected(i)}
                            className="w-full text-left px-3 py-2 font-mono text-xs"
                            style={{
                                background: i === selected ? 'color-mix(in srgb, var(--accent-primary) 12%, transparent)' : 'transparent',
                                color: i === selected ? 'var(--accent-primary)' : 'var(--text-secondary)',
                            }}
                        >
                            {cmd}
                        </button>
                    ))}
                </div>
            </div>
        </div>
    );
}
