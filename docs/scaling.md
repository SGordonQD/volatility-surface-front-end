# Scaling

Vol Surface is built for high-frequency crypto options market data, where implied volatility, options smile points, risk reversal nodes, and SVI volatility surface diagnostics can update many times per second. Scaling is mainly about keeping websocket ingestion compact, avoiding avoidable browser work, and making the API publish only the surface changes that matter.

## Websocket Ingestion

The API should prefer snapshots for initial state and patches for ongoing updates. This keeps Deribit, Binance, OKX, and other real-time market data feeds from forcing full crypto options surface reloads on every tick.

Recommended message strategy:

- Send one `svi_surface_snapshot` for the active feed after connection.
- Send `svi_surface_patch` updates when fitted SVI volatility surface parameters, fit status, or tenor rows change.
- Send `smile_levels_patch`, `smile_levels_add`, and `smile_levels_remove` for incremental options smile and implied volatility quote changes.
- Include an optional `ccy` field so the UI can label the active BTC, ETH, or altcoin surface.
- Keep exchange-specific fields for Deribit, Binance, OKX, and other venues so the UI can compare multi-exchange implied volatility quotes without duplicating the whole options smile.

## Browser Backpressure

The browser queue has guardrails for pending websocket messages, dropped messages, and flush timing. These diagnostics are exposed through debug mode so operators can see when real-time market data ingestion is outrunning rendering.

Practical scaling rules:

- Batch fast exchange quote updates into compact websocket patches.
- Prefer numeric fields over verbose nested structures for high-volume implied volatility ticks.
- Avoid resending static expiry, tenor, and strike metadata unless it changes.
- Partition heavy backend work upstream so one active surface feed does not block calibration or websocket fanout.
- Keep rendering state derived from merged snapshots rather than from raw websocket event history.

## Rendering Strategy

Dense options smile and SVI volatility surface views are rendered with canvas-based charts where possible. This avoids excessive DOM churn when implied volatility points, risk reversal nodes, and exchange quote overlays update quickly.

The UI also uses deferred values and memoised chart builders so expensive SVI volatility surface grids and smile matrices are rebuilt only when relevant input state changes.

## API And Infrastructure

For production deployments:

- Serve the static dashboard from CloudFront, nginx, or another CDN-backed HTTPS endpoint.
- Run websocket APIs close to the pricing and calibration services to reduce real-time market data latency.
- Use `wss://` for public deployments.
- Put exchange ingestion, SVI fitting, and websocket broadcasting on separate runtime boundaries so slow consumers do not block calibration.
- Track queue depth, fit latency, websocket reconnects, dropped messages, and per-currency update rates.

## Operational Signals

Useful metrics for scaling a crypto options volatility surface platform:

- Websocket messages per second by currency and exchange.
- Bytes per second by message family.
- Pending browser messages and dropped browser messages.
- SVI fit elapsed time and time since last successful fit.
- Options smile quote age by Deribit, Binance, OKX, and other venues.
- Risk reversal and fly update latency.
- Browser render frame timing for surface, smile, and grid views.
