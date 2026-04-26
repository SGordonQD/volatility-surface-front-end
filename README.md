# SVI Surface Dashboard

Realtime React dashboard for monitoring fitted SVI variance surfaces, quoted option smiles, risk-reversal nodes, fly nodes, tenor slices, and quote-vs-fit dislocations.

The frontend connects to a websocket API that streams surface snapshots and incremental patches. It is designed for high-frequency option quote updates, multiple exchanges, and dense visual monitoring on desktop, with a compact mobile layout for quick checks.

## Features

- Live variance surface and optional 3D surface view.
- Per-expiry smile matrix with bid, ask, OKX, Deribit, and last-trade IV markers.
- Risk-reversal and fly grids with expiry or tenor row modes.
- Node charts and RR/fly-by-days charts.
- SVI-through matrix showing bid/ask levels through the fitted mid.
- First-visit data quality, disclaimer, and GDPR notice.
- Runtime crash boundary and debug diagnostics for websocket queues, render time, and heap usage.
- Docker/nginx packaging for serving the built frontend.

## Requirements

- Node `>=20.19.0`.
- npm.
- A websocket API that serves the SVI stream.

The project includes `.nvmrc`, so with `nvm` you can run:

```bash
nvm use
```

## Local Development

Install dependencies:

```bash
npm install
```

Run the Vite dev server:

```bash
npm run dev
```

By default the frontend connects to:

```text
ws://localhost:8765
```

To point the dev server at a remote websocket API:

```bash
VITE_SVI_WS_URL=ws://18.130.75.41:8765 npm run dev
```

If the site is served over HTTPS, the websocket must use `wss://...` or the browser will block the connection as mixed content.

## Scripts

```bash
npm run dev
```

Starts the local Vite development server.

```bash
npm run build
```

Runs TypeScript build checks and creates the production build in `dist/`.

```bash
npm run preview
```

Serves the production build locally.

```bash
npm run lint
```

Runs ESLint, including React Hooks and React Compiler checks.

```bash
npm run build:export -- /absolute/path/to/other-repo/frontend
```

Builds the app and copies `dist/` into another repo at `frontend/dist`.

## Websocket Configuration

The frontend websocket URL is resolved from:

```text
VITE_SVI_WS_URL
```

If the value starts with `/`, the app resolves it against the current host and protocol. For example `/ws` becomes:

```text
ws://current-host/ws
```

or, on HTTPS:

```text
wss://current-host/ws
```

If no value is provided, the app falls back to:

```text
ws://localhost:8765
```

## Expected Stream

The app supports snapshot and patch-style messages for:

- `svi_surface_snapshot`
- `svi_surface_patch`
- `smile_levels_snapshot`
- `smile_levels_patch`
- `smile_levels_add`
- `smile_levels_remove`
- `svi_tenor_snapshot`
- `svi_tenor_patch`
- `surface_fit_status`
- `svi_fly_patch`

The current preferred surface format is schema version `1` with per-expiry smiles, `x_axis`, `var`, `vol`, risk-reversal nodes, fly nodes, and tenor rows.

## Docker

Build and run the frontend plus API container:

```bash
docker compose up --build
```

The frontend is served at:

```text
http://localhost:8080
```

The included nginx config proxies:

```text
/ws -> api:8765
```

By default compose expects an API image called:

```text
svi-api:latest
```

Override it with:

```bash
SVI_API_IMAGE=your-registry/your-api:tag docker compose up --build
```

To build the frontend container against a direct websocket URL:

```bash
VITE_SVI_WS_URL=ws://18.130.75.41:8765 docker compose up --build frontend
```

## Static Deployment

For S3, CloudFront, nginx, or any static host:

```bash
npm run build
```

Upload the contents of:

```text
dist/
```

Set `VITE_SVI_WS_URL` at build time if the deployed site should connect to a fixed API:

```bash
VITE_SVI_WS_URL=wss://your-api.example.com/ws npm run build
```

Static hosting only serves the frontend. The websocket API must still be reachable from the browser.

## Export Into Another Repo

If another repo serves this frontend from `frontend/dist`, run:

```bash
npm run build:export -- /absolute/path/to/other-repo/frontend
```

Or use:

```bash
TARGET_FRONTEND_DIR=/absolute/path/to/other-repo/frontend npm run build:export
```

## Debugging

Enable runtime diagnostics in the browser console:

```js
localStorage.setItem("SVI_DEBUG", "1")
location.reload()
```

This enables:

- `[svi-debug] feed` console samples every 5 seconds.
- `window.__SVI_DEBUG__` for websocket queue, dropped message, flush timing, and tracked expiry metrics.
- `window.__SVI_RENDER_DEBUG__` for canvas frame timing.
- A small on-page debug overlay with queue, heap, chart count, and render timing.

Disable it with:

```js
localStorage.removeItem("SVI_DEBUG")
location.reload()
```

To inspect captured runtime crashes:

```js
JSON.parse(localStorage.getItem("SVI_CRASH_LOG") || "[]")
```

## Data Notice

This dashboard is a monitoring tool for live market and model data. Streamed values may be delayed, incomplete, stale, interpolated, extrapolated, or otherwise inaccurate. It should not be treated as trading advice or a source of record.

The first-visit modal includes a data quality and GDPR notice. Keep that notice in place if the app is exposed beyond local development.

## Troubleshooting

If the page does not connect, check `VITE_SVI_WS_URL`, browser mixed-content warnings, websocket security group/firewall rules, and whether the API is listening on the expected port.

If charts feel static, enable `SVI_DEBUG` and check `pendingQueue`, `receivedMessages`, `lastFlushMs`, and websocket connection state.

If the browser tab crashes after running for a while, enable `SVI_DEBUG`, reproduce the issue, then inspect `SVI_CRASH_LOG` and `window.__SVI_DEBUG__`.

If a production build fails, run:

```bash
npm run lint
npm run build
```

These are the same checks used before pushing changes.

## Project Structure

```text
src/App.tsx                     Main dashboard layout and panels
src/App.css                     Dashboard styling and responsive layout
src/hooks/useSviFeed.ts         Websocket ingestion and state merging
src/lib/svi-charting.ts         Chart data builders and formatting helpers
src/lib/svi-types.ts            Stream and chart TypeScript types
src/components/CanvasCharts.tsx Canvas-based smile and variance charts
src/components/Surface3DCanvas.tsx 3D surface renderer
src/components/AppErrorBoundary.tsx Runtime crash boundary
scripts/export-dist.sh          Copies build output to another repo
Dockerfile                      Production frontend image
nginx.conf                      Static serving and websocket proxy
docker-compose.yml              Frontend plus API local deployment
```
