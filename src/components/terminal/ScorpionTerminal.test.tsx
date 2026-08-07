import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ScorpionTerminal from './ScorpionTerminal';

/**
 * The terminal's own logic is layout and keyboard handling — execution lives
 * entirely behind /api/terminal/exec, which is tested on the backend. So `fetch`
 * is stubbed and the assertions are about what the UI does with the response,
 * not about what the verb did.
 */

vi.mock('../../contexts/AuthContext', () => ({
    useAuth: () => ({ getJWT: async () => 'test-jwt' }),
}));

const mockFetch = vi.fn();

/** Default: every command succeeds with one echoed line. */
function respondWith(lines: string[], ok = true, status = 200, error?: string) {
    const body = JSON.stringify(ok ? { lines } : { error });
    mockFetch.mockResolvedValue({ ok, status, text: async () => body });
}

/** A body the terminal route never produces — i.e. something in front of it answered. */
function respondRaw(status: number, body: string) {
    mockFetch.mockResolvedValue({ ok: status < 400, status, text: async () => body });
}

beforeEach(() => {
    mockFetch.mockReset();
    respondWith(['ok']);
    vi.stubGlobal('fetch', mockFetch);
    // scrollIntoView and scrollTo are unimplemented in jsdom; the component calls
    // both, and an unhandled TypeError would fail tests for the wrong reason.
    Element.prototype.scrollIntoView = vi.fn();
    Element.prototype.scrollTo = vi.fn() as unknown as Element['scrollTo'];
});

afterEach(() => {
    vi.unstubAllGlobals();
});

const promptInput = () => screen.getAllByLabelText('Terminal command input')[0];

describe('startup', () => {
    it('renders the banner and a single pane', () => {
        render(<ScorpionTerminal />);
        expect(screen.getByText(/audited command surface/i)).toBeInTheDocument();
        expect(screen.getAllByLabelText('Terminal command input')).toHaveLength(1);
    });

    it('hides the tab strip until there is more than one tab', () => {
        render(<ScorpionTerminal />);
        expect(screen.queryByRole('tab')).not.toBeInTheDocument();
    });
});

describe('running a command', () => {
    it('echoes the command and renders the returned lines', async () => {
        const user = userEvent.setup();
        respondWith(['user:  op@scorpion.local']);
        render(<ScorpionTerminal />);

        await user.type(promptInput(), 'whoami{Enter}');

        expect(await screen.findByText('scorpion> whoami')).toBeInTheDocument();
        // Regex, not an exact string: getByText normalizes runs of whitespace, and
        // the column alignment in whoami's output is deliberate double-spacing.
        expect(screen.getByText(/op@scorpion\.local/)).toBeInTheDocument();
    });

    it('posts to the exec endpoint with the typed command', async () => {
        const user = userEvent.setup();
        render(<ScorpionTerminal />);

        await user.type(promptInput(), 'help{Enter}');

        expect(mockFetch).toHaveBeenCalledWith('/api/terminal/exec', expect.objectContaining({
            method: 'POST',
            body: JSON.stringify({ command: 'help' }),
        }));
    });

    it('renders a rejection from the server rather than swallowing it', async () => {
        const user = userEvent.setup();
        respondWith([], false, 404, "unknown command 'rm' — try 'help'");
        render(<ScorpionTerminal />);

        await user.type(promptInput(), 'rm -rf /{Enter}');

        expect(await screen.findByText(/unknown command 'rm'/)).toBeInTheDocument();
    });

    it('surfaces a network failure instead of appearing to succeed', async () => {
        const user = userEvent.setup();
        mockFetch.mockRejectedValue(new Error('connection refused'));
        render(<ScorpionTerminal />);

        await user.type(promptInput(), 'help{Enter}');

        expect(await screen.findByText(/could not reach \/api\/terminal\/exec — connection refused/)).toBeInTheDocument();
        expect(screen.getByText(/did not run and was not audited/)).toBeInTheDocument();
    });

    /**
     * The reported bug: nginx answers 502 with an HTML page when the backend
     * container is down. Parsing that as JSON yielded `{}` and the pane printed a
     * bare "Request failed (502)" — true, useless, and indistinguishable from the
     * route rejecting the command.
     */
    it('names the transport when a proxy answers instead of the route', async () => {
        const user = userEvent.setup();
        respondRaw(502, '<html><head><title>502 Bad Gateway</title></head><body><h1>502 Bad Gateway</h1></body></html>');
        render(<ScorpionTerminal />);

        await user.type(promptInput(), 'git clone x{Enter}');

        expect(await screen.findByText(/the audited backend never answered \(HTTP 502\)/)).toBeInTheDocument();
        expect(screen.getByText(/did not run and was not audited/)).toBeInTheDocument();
        expect(screen.getByText(/upstream: 502 Bad Gateway/)).toBeInTheDocument();
        expect(screen.queryByText(/Request failed/)).not.toBeInTheDocument();
    });

    /** A 200 carrying index.html means /api was never proxied — still a transport fault. */
    it('treats a non-JSON 200 as a transport fault rather than empty output', async () => {
        const user = userEvent.setup();
        respondRaw(200, '<!doctype html><html><body><div id="root"></div></body></html>');
        render(<ScorpionTerminal />);

        await user.type(promptInput(), 'help{Enter}');

        expect(await screen.findByText(/the audited backend never answered \(HTTP 200\)/)).toBeInTheDocument();
    });

    it('ignores a blank submission', async () => {
        const user = userEvent.setup();
        render(<ScorpionTerminal />);

        await user.type(promptInput(), '   {Enter}');

        expect(mockFetch).not.toHaveBeenCalled();
    });
});

describe('shell profile selector', () => {
    it('offers the audited shell alongside the native profiles', () => {
        render(<ScorpionTerminal />);
        const selector = screen.getByLabelText('Terminal profile');

        expect(within(selector).getByRole('option', { name: 'Scorpion Audited Shell' })).toBeInTheDocument();
        ['Git Bash', 'PowerShell', 'Command Prompt', 'Bash / WSL'].forEach((label) => {
            expect(within(selector).getByRole('option', { name: label })).toBeInTheDocument();
        });
    });

    it('opens another audited tab when the audited profile is chosen', async () => {
        const user = userEvent.setup();
        render(<ScorpionTerminal />);
        expect(screen.queryByRole('tab')).not.toBeInTheDocument();

        await user.selectOptions(screen.getByLabelText('Terminal profile'), 'scorpion');

        expect(screen.getAllByRole('tab')).toHaveLength(2);
    });

    /**
     * The selector is a launcher, not a state display. If it retained the last choice,
     * re-picking that profile would fire no change event and the entry would be dead.
     */
    it('returns to the placeholder so any profile can be picked twice', async () => {
        const user = userEvent.setup();
        render(<ScorpionTerminal />);
        const selector = screen.getByLabelText('Terminal profile');

        await user.selectOptions(selector, 'scorpion');
        await user.selectOptions(selector, 'scorpion');

        expect(screen.getAllByRole('tab')).toHaveLength(3);
    });

    /**
     * A browser cannot spawn PowerShell, so the honest behaviour is to hand off and
     * say so. Silently doing nothing, or printing a fake prompt, would both read as
     * "the native shell is running here" — which is exactly what must not be implied
     * on a surface whose whole value is that everything on it is audited.
     */
    it('deep-links a native profile to the extension and states it is unaudited', async () => {
        const user = userEvent.setup();
        const navigated: string[] = [];
        // jsdom refuses to navigate to a custom scheme; capture the assignment instead.
        Object.defineProperty(window, 'location', {
            configurable: true,
            value: { set href(url: string) { navigated.push(url); } },
        });
        render(<ScorpionTerminal />);

        await user.selectOptions(screen.getByLabelText('Terminal profile'), 'scorpion.gitbash');

        expect(navigated).toEqual(['vscode://scorpion.scorpion-security/terminal?profile=scorpion.gitbash']);
        expect(await screen.findByText(/Opening Git Bash in VS Code/)).toBeInTheDocument();
        expect(screen.getByText(/not through the audit ledger/)).toBeInTheDocument();
        // The handoff must not be mistaken for a new local session.
        expect(screen.getAllByLabelText('Terminal command input')).toHaveLength(1);
    });
});

describe('history recall', () => {
    it('walks previous commands with ArrowUp and back with ArrowDown', async () => {
        const user = userEvent.setup();
        render(<ScorpionTerminal />);
        const input = promptInput();

        await user.type(input, 'help{Enter}');
        await user.type(input, 'whoami{Enter}');

        await user.type(input, '{ArrowUp}');
        expect(input).toHaveValue('whoami');

        await user.type(input, '{ArrowUp}');
        expect(input).toHaveValue('help');

        await user.type(input, '{ArrowDown}');
        expect(input).toHaveValue('whoami');
    });
});

describe('clear', () => {
    /** The offline fallback: clearing changes no server state, so it must not need the backend. */
    it('services a typed `clear` locally, without a request', async () => {
        const user = userEvent.setup();
        respondWith(['some output']);
        render(<ScorpionTerminal />);

        await user.type(promptInput(), 'help{Enter}');
        expect(await screen.findByText('some output')).toBeInTheDocument();
        mockFetch.mockClear();

        await user.type(promptInput(), 'clear{Enter}');

        expect(mockFetch).not.toHaveBeenCalled();
        expect(screen.queryByText('some output')).not.toBeInTheDocument();
        expect(screen.getByText(/command history retained/i)).toBeInTheDocument();
    });

    it('clears the screen but keeps history recallable', async () => {
        const user = userEvent.setup();
        respondWith(['some output']);
        render(<ScorpionTerminal />);
        const input = promptInput();

        await user.type(input, 'help{Enter}');
        expect(await screen.findByText('some output')).toBeInTheDocument();

        await user.click(screen.getByLabelText('Clear terminal'));

        expect(screen.queryByText('some output')).not.toBeInTheDocument();
        expect(screen.getByText(/command history retained/i)).toBeInTheDocument();

        // The point of keeping history: the command is still recallable.
        await user.type(promptInput(), '{ArrowUp}');
        expect(promptInput()).toHaveValue('help');
    });
});

describe('splitting and tabs', () => {
    it('split adds a second pane to the same tab', async () => {
        const user = userEvent.setup();
        render(<ScorpionTerminal />);

        await user.click(screen.getByLabelText('Split terminal'));

        expect(screen.getAllByLabelText('Terminal command input')).toHaveLength(2);
        expect(screen.queryByRole('tab')).not.toBeInTheDocument();
    });

    it('new terminal adds a tab and shows the tab strip', async () => {
        const user = userEvent.setup();
        render(<ScorpionTerminal />);

        await user.click(screen.getByLabelText('New terminal'));

        expect(screen.getAllByRole('tab')).toHaveLength(2);
    });

    it('panes keep independent scrollback', async () => {
        const user = userEvent.setup();
        respondWith(['from pane one']);
        render(<ScorpionTerminal />);

        await user.type(promptInput(), 'help{Enter}');
        expect(await screen.findByText('from pane one')).toBeInTheDocument();

        await user.click(screen.getByLabelText('Split terminal'));

        // The new pane starts clean; the first pane's output is still on screen.
        const inputs = screen.getAllByLabelText('Terminal command input');
        expect(inputs).toHaveLength(2);
        expect(screen.getAllByText(/audited command surface/i).length).toBe(2);
        expect(screen.getAllByText('from pane one')).toHaveLength(1);
    });

    it('closing the only tab leaves a fresh terminal rather than an empty screen', async () => {
        const user = userEvent.setup();
        render(<ScorpionTerminal />);

        await user.click(screen.getByLabelText('New terminal'));
        const tabs = screen.getAllByRole('tab');
        for (const tab of tabs) {
            await user.click(within(tab).getByRole('button'));
        }

        expect(screen.getAllByLabelText('Terminal command input').length).toBeGreaterThanOrEqual(1);
    });
});

describe('domain verbs', () => {
    /**
     * The verbs themselves are tested in backend/src/services/terminal/
     * domainVerbs.test.ts, against the real service layer and its tenancy
     * checks. What matters here is that the pane renders multi-line, aligned
     * output faithfully — including the blank lines the verbs use as separators,
     * which a naive renderer would collapse.
     */
    it('renders gate status output line for line', async () => {
        const user = userEvent.setup();
        respondWith([
            'repo:      repo1',
            'verdict:   BLOCKED',
            'score:     40% (minimum 80%)',
            'blockers:  1',
            '',
            'top blockers (showing 1):',
            '  CRITICAL RCE in parser (left-pad)',
        ]);
        render(<ScorpionTerminal />);

        await user.type(promptInput(), 'gate status repo1{Enter}');

        expect(await screen.findByText(/verdict:\s+BLOCKED/)).toBeInTheDocument();
        expect(screen.getByText(/CRITICAL RCE in parser/)).toBeInTheDocument();
    });

    it('renders a pipeline table without mangling its column padding', async () => {
        const user = userEvent.setup();
        respondWith([
            'RUN                   REPO                  STATUS      COMMIT',
            'run-1                 repo1                 success     abcdef12',
        ]);
        render(<ScorpionTerminal />);

        await user.type(promptInput(), 'pipeline ls{Enter}');

        expect(await screen.findByText(/run-1\s+repo1\s+success\s+abcdef12/)).toBeInTheDocument();
    });

    it('shows a role denial from provenance show as an error, not as output', async () => {
        const user = userEvent.setup();
        respondWith([], false, 403, "'provenance' requires role admin — you have 'user'");
        render(<ScorpionTerminal />);

        await user.type(promptInput(), 'provenance show sha256:abc{Enter}');

        const line = await screen.findByText(/requires role admin/);
        expect(line).toHaveStyle({ color: 'var(--accent-danger, #f87171)' });
    });
});

describe('recent command picker', () => {
    it('opens from the toolbar and lists what this pane has run', async () => {
        const user = userEvent.setup();
        render(<ScorpionTerminal />);

        await user.type(promptInput(), 'help{Enter}');
        await user.click(screen.getByLabelText('Run recent command'));

        const dialog = await screen.findByRole('dialog', { name: /run recent command/i });
        expect(within(dialog).getByText('help')).toBeInTheDocument();
    });

    it('opens with Ctrl+Alt+R', async () => {
        const user = userEvent.setup();
        render(<ScorpionTerminal />);

        await user.click(promptInput());
        await user.keyboard('{Control>}{Alt>}r{/Alt}{/Control}');

        expect(await screen.findByRole('dialog', { name: /run recent command/i })).toBeInTheDocument();
    });

    it('filters, and running a pick re-issues the command', async () => {
        const user = userEvent.setup();
        render(<ScorpionTerminal />);
        const input = promptInput();

        await user.type(input, 'help{Enter}');
        await user.type(input, 'whoami{Enter}');
        mockFetch.mockClear();

        await user.click(screen.getByLabelText('Run recent command'));
        const dialog = await screen.findByRole('dialog', { name: /run recent command/i });
        await user.type(within(dialog).getByLabelText('Filter recent commands'), 'who');

        expect(within(dialog).queryByText('help')).not.toBeInTheDocument();
        await user.click(within(dialog).getByText('whoami'));

        expect(mockFetch).toHaveBeenCalledWith('/api/terminal/exec', expect.objectContaining({
            body: JSON.stringify({ command: 'whoami' }),
        }));
    });

    it('says so plainly when nothing has been run yet', async () => {
        const user = userEvent.setup();
        render(<ScorpionTerminal />);

        await user.click(screen.getByLabelText('Run recent command'));

        expect(await screen.findByText(/no commands run in this pane yet/i)).toBeInTheDocument();
    });
});
