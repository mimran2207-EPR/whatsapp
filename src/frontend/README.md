# ResidentComms — frontend

Angular 21 (standalone components, signals, zoneless, Vitest) for the M1 vertical slice of the resident-communication
system: import, SMS wizard, approval, tracking. Hebrew, RTL. Everything runs against the **Sandbox (mock)** provider
with synthetic data; there is no real SMS and no real resident data.

Run everything together from the repository root with `scripts/dev-up.ps1` (see the root `README.md`).

## Commands

Run from `src/frontend`. Start with `npm ci` (never `npm install`, so the lockfile stays authoritative).

| Command | What it does |
| --- | --- |
| `npm ci` | Install exact dependencies from `package-lock.json`. |
| `npm start` | Build tokens, then `ng serve` on http://localhost:4200 (proxies `/v1` to the API on :5080, see `proxy.conf.json`). |
| `npm test` | Token build tests (node:test) and the unit/component tests (Vitest). |
| `npm run build` | Build tokens, then the production build into `dist/resident-comms/browser`. |
| `npx playwright install chromium` | Once, for the e2e. |
| `npm run e2e` | M1 end-to-end flow. Needs `sqlcmd` on PATH and a local SQL Server; see below. |

### End-to-end

`playwright.config.ts` has no side effects when loaded. `e2e/global-setup.ts` builds the backend, creates a throwaway
database `ResidentComms_Test_<guid>` (never `whatsapp`), then starts the API (:5180), the Worker (deterministic mock)
and `ng serve` (:4280) with per-run random signing keys. `e2e/global-teardown.ts` stops them and drops the database;
setup does the same if it fails part-way. Process logs are in `test-results/logs/`.

## Structure

```
src/app/
  core/       API client, auth (dev login, guard, interceptors), idempotency keys, polling, error copy
  ui/         design-system components (button, banner, kpi-card, app-shell, ...) built from the Figma blueprint
  features/   login, home, campaigns (list, wizard, tracking), approvals, layout (signed-in shell)
  dev/        UI gallery for visual comparison with Figma (development builds only, route /__ui)
src/styles/   tokens.css (generated) and shared feature styles
design/       tokens.json — the exported Figma tokens (source of truth for colors, spacing, type)
scripts/      build-tokens.mjs and its tests
e2e/          Playwright flow, stack setup/teardown, XLSX fixture
```

## Design tokens

`design/tokens.json` is the Figma export. `npm run tokens` (run automatically before `start`, `build` and `test:ui`)
turns it into `src/styles/tokens.css` (CSS custom properties and text utility classes). Components use the custom
properties only; the single approved exception is the home hero gradient, whose two stops are local custom properties
checked for contrast by `scripts/home-hero-contrast.test.mjs`.

## Accessibility notes

After each route change focus moves to the page's `h1` and the page title is announced (live region in `app.ts`);
the app shell starts with a skip-to-content link. Do not add focusable controls that do nothing: unbuilt controls are
rendered disabled and labelled "בקרוב".
