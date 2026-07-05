# Scorpion Dashboard — Design Spec (2026-07-05)

## Goal

Premium light-mode main screen for Scorpion (DevSecOps threat monitoring), seeded into
`starter-for-react/` as the real frontend shell. Enterprise IT audience. Stripe-level
polish, high signal-to-noise.

## Decisions

- **Placement (revised):** real frontend lives at repo root (`src/`, 40+ pages).
  Page added as `src/pages/SecurityOverview.tsx`, route `/overview` in `App.tsx`,
  rendered inside existing Sidebar/Navbar chrome. Stack: React 18 + Tailwind 3 + Vite 8.
  Colors mapped to the app's theme CSS variables (`--bg-card`, `--border`,
  `--text-primary/secondary/muted`, `--accent-primary`, `--danger`) so the page follows
  every theme; the spec palette below is the reference light-mode rendering.
  starter-for-react changes were fully reverted.
- **Content:** mock data shaped like the real backend — Falco runtime events (severity,
  rule, pod, suppressed/override from managed rules), scan queue (DAST/SBOM/Docker),
  compliance gates, DevSecOps lifecycle Plan→Monitor.
- **Layout:** sidebar command-center (lifecycle nav) over top-nav editorial and
  three-pane SOC console — matches enterprise muscle memory, lowest noise.

## Design system ("Scorpion Light")

- Canvas `#FAFAF9`, surface `#FFFFFF`, border `#E7E5E4` (1px hairlines separate; shadows rare).
- Ink `#1C1917` / `#57534E` / `#A8A29E`.
- Accent `#4F46E5` (interaction only). Severity: critical `#DC2626`, high `#EA580C`,
  medium `#D97706`, low/pass `#16A34A`, info `#2563EB`. Red reserved for real criticals.
- Shadow recipe (elevated cards only): `0 1px 2px rgb(0 0 0 / .04), 0 4px 16px rgb(0 0 0 / .04)`.
- Inter/system-ui. Scale: 11 label-caps · 13 meta · 14 body · 16 card title · 22 page
  title · 30 KPI (`tabular-nums`). Semibold, `tracking-tight` headings.
- `rounded-xl` cards, `rounded-md` controls, 8pt grid. Severity = dot + label, never
  color alone. Pills: 11px on ~8% tinted semantic background.

## Screen structure

1. Sidebar: lifecycle nav (Plan, Code, Build, Test, Release, Deploy, Operate, Monitor)
   plus settings; collapses under `lg`.
2. Top bar: env selector, search, compliance-gate status pill, user.
3. Main: header (title + posture + primary action) → KPI ×4 (critical findings, Falco
   events 24h, gate pass rate, active scans) → pipeline strip (stage health) →
   Falco feed (⅔) beside scan queue + gates (⅓).
4. Responsive: KPI 4→2→1; columns stack; sidebar → hamburger.

## Acceptance

- Renders via `vite dev`, no console errors; responsive at 375/768/1440.
- Accessible: semantic landmarks, focus-visible rings, aria-labels on icon buttons,
  severity never color-only.
- Self-contained component ≤ ~800 lines, mock data internal, ready to wire to real
  backend routes later.
