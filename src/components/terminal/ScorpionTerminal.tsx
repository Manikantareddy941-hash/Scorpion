import { useState } from 'react';
import { Terminal as TerminalIcon, Plus, SplitSquareHorizontal, Eraser, ExternalLink, History, X } from 'lucide-react';
import { useTerminalSession } from './useTerminalSession';
import { TerminalPane } from './TerminalPane';
import { RecentCommands } from './RecentCommands';
import { SHELL_PROFILES, SCORPION_PROFILE_ID, findProfile, vscodeTerminalUri } from './shellProfiles';

/**
 * Scorpion Terminal — tabs, split panes, and the toolbar.
 *
 * This is an IDE-shaped client over a fixed verb registry, not a shell: the backend
 * tokenises input and looks the first token up in a Map. The profile selector is
 * therefore a *host* selector, not a shell switch — the audited profile runs here,
 * and native profiles are handed to the SCORPION VS Code extension, which is the
 * only party in this system that can legitimately spawn a process on your machine.
 * See ./shellProfiles.ts for why that boundary is where it is.
 */

export default function ScorpionTerminal() {
    const session = useTerminalSession();
    const [recentOpen, setRecentOpen] = useState(false);

    const { activeTab, tabs, panes } = session;
    const activePane = panes[activeTab.activePaneId];
    const visiblePanes = activeTab.paneIds.map((id) => panes[id]).filter(Boolean);

    const toolbarButton = {
        color: 'var(--text-secondary)',
        border: '1px solid var(--border-subtle)',
        background: 'var(--bg-secondary)',
    };

    /**
     * A native profile cannot open in this tab, so say what happened rather than
     * appearing to have spawned something. The audit line is not decoration: a shell
     * opened this way is genuinely outside the ledger, and an operator reading the
     * chain later needs to know that gap is expected.
     */
    const launchProfile = (profileId: string) => {
        if (profileId === SCORPION_PROFILE_ID) {
            session.addTab();
            return;
        }
        const profile = findProfile(profileId);
        if (!profile || !activePane) return;

        window.location.href = vscodeTerminalUri(profile.id);
        session.notify(activePane.id, [
            `Opening ${profile.label} in VS Code via the SCORPION extension.`,
            '  It runs on your machine with your privileges — not on the control plane,',
            '  and not through the audit ledger. Nothing you type there is recorded here.',
            '  If no terminal appears, install the SCORPION extension and reload VS Code.',
        ]);
    };

    return (
        <div className="flex flex-col h-full p-4 gap-3" style={{ background: 'var(--bg-primary)' }}>
            <header className="flex items-center gap-2 shrink-0 flex-wrap">
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

                <div className="flex items-center gap-1 ml-auto">
                    {/*
                      * A plain <select>: keyboard- and screen-reader-correct for free, and it
                      * renders as the platform's own menu. A custom popover here would be ~150
                      * lines re-implementing what the element already does.
                      *
                      * It is pinned to a placeholder rather than to the chosen profile, which
                      * makes it a launcher instead of a state display. Two reasons, both bugs
                      * found the other way round: pinning it to the active profile means
                      * re-picking that profile fires no change event and the entry is dead;
                      * and leaving a native profile displayed after a handoff would imply this
                      * pane is a Git Bash session when it is still the audited shell.
                      */}
                    <select
                        aria-label="Terminal profile"
                        title="Open a terminal profile"
                        value=""
                        onChange={(e) => launchProfile(e.target.value)}
                        className="px-2 py-1 rounded text-xs"
                        style={toolbarButton}
                    >
                        <option value="" disabled>Profile…</option>
                        {SHELL_PROFILES.map((profile) => (
                            <option key={profile.id} value={profile.id} title={profile.description}>
                                {profile.label}
                            </option>
                        ))}
                    </select>
                    <button type="button" onClick={session.addTab} title="New Terminal" aria-label="New terminal"
                        className="flex items-center gap-1 px-2 py-1 rounded text-xs" style={toolbarButton}>
                        <Plus size={12} /> New
                    </button>
                    <button type="button" onClick={session.splitActiveTab} title="Split Terminal" aria-label="Split terminal"
                        className="flex items-center gap-1 px-2 py-1 rounded text-xs" style={toolbarButton}>
                        <SplitSquareHorizontal size={12} /> Split
                    </button>
                    <button type="button" onClick={() => setRecentOpen(true)} title="Run Recent Command (Ctrl+Alt+R)" aria-label="Run recent command"
                        className="flex items-center gap-1 px-2 py-1 rounded text-xs" style={toolbarButton}>
                        <History size={12} /> Recent
                    </button>
                    <button type="button" onClick={() => activePane && session.clearPane(activePane.id)} title="Clear Terminal (Ctrl+L)" aria-label="Clear terminal"
                        className="flex items-center gap-1 px-2 py-1 rounded text-xs" style={toolbarButton}>
                        <Eraser size={12} /> Clear
                    </button>
                    <button type="button" onClick={() => window.open('/terminal', '_blank', 'noopener,noreferrer')} title="New Terminal Window" aria-label="Open terminal in a new window"
                        className="flex items-center gap-1 px-2 py-1 rounded text-xs" style={toolbarButton}>
                        <ExternalLink size={12} /> Window
                    </button>
                </div>
            </header>

            {/* Tab strip. Hidden at one tab so a single session has no chrome to explain. */}
            {tabs.length > 1 && (
                <div className="flex items-center gap-1 shrink-0 overflow-x-auto">
                    {tabs.map((tab) => {
                        const isActive = tab.id === session.activeTabId;
                        return (
                            <div
                                key={tab.id}
                                className="flex items-center gap-1 px-2 py-1 rounded-t text-xs cursor-pointer shrink-0"
                                style={{
                                    background: isActive ? 'var(--bg-card)' : 'transparent',
                                    color: isActive ? 'var(--accent-primary)' : 'var(--text-muted)',
                                    borderBottom: `2px solid ${isActive ? 'var(--accent-primary)' : 'transparent'}`,
                                }}
                                onClick={() => session.setActiveTabId(tab.id)}
                                role="tab"
                                aria-selected={isActive}
                            >
                                <span>{tab.title}{tab.paneIds.length > 1 ? ` (${tab.paneIds.length})` : ''}</span>
                                <button
                                    type="button"
                                    onClick={(e) => { e.stopPropagation(); session.closeTab(tab.id); }}
                                    aria-label={`Close ${tab.title}`}
                                    className="p-0.5 rounded"
                                    style={{ color: 'var(--text-muted)' }}
                                >
                                    <X size={10} />
                                </button>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Panes sit side by side; a single pane fills the row unchanged. */}
            <div className="flex-1 min-h-0 flex gap-2">
                {visiblePanes.map((pane) => (
                    <TerminalPane
                        key={pane.id}
                        pane={pane}
                        isFocused={pane.id === activeTab.activePaneId}
                        canClose={visiblePanes.length > 1 || tabs.length > 1}
                        onFocus={() => session.focusPane(activeTab.id, pane.id)}
                        onRun={(command) => session.run(pane.id, command)}
                        onClear={() => session.clearPane(pane.id)}
                        onClose={() => session.closePane(activeTab.id, pane.id)}
                        onOpenRecent={() => { session.focusPane(activeTab.id, pane.id); setRecentOpen(true); }}
                    />
                ))}
            </div>

            {recentOpen && activePane && (
                <RecentCommands
                    history={activePane.history}
                    onPick={(command) => { setRecentOpen(false); session.run(activePane.id, command); }}
                    onClose={() => setRecentOpen(false)}
                />
            )}
        </div>
    );
}
