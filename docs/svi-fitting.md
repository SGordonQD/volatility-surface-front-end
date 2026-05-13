# SVI Fitting

SVI, or stochastic volatility inspired parametrisation, is a common way to represent an implied volatility smile across strikes for a fixed expiry. Vol Surface uses SVI fitting output from the upstream pricing stack to display a real-time crypto options SVI volatility surface, per-expiry options smile charts, risk reversal nodes, fly nodes, and fit-quality diagnostics.

## Inputs

The upstream calibration process typically starts with real-time market data from Deribit, Binance, OKX, and other crypto options venues:

- Bid and ask quotes by currency, expiry, strike, and option type.
- Last-trade implied volatility points.
- Underlying, future, or forward reference prices.
- Exchange-specific quote metadata for multi-venue comparison.
- Existing risk reversal and fly marks when available.

The UI expects those inputs after they have already been normalised by the pricing engine. It does not perform exchange connectivity or production SVI calibration itself.

## Smile And Surface

An SVI fit produces a smooth options smile for each expiry. Combining fitted smiles across expiries gives the SVI volatility surface used by traders and quant developers to inspect crypto options implied volatility.

The dashboard displays:

- Per-expiry options smile charts with bid, ask, and trade implied volatility points.
- SVI fitted mid curves.
- Variance and volatility term structure views.
- Risk reversal nodes across expiries.
- Fly nodes and tenor rows.
- Quote-through-fit diagnostics for exchange quotes that cross the fitted SVI implied volatility mid.

## Fit Quality

The UI surfaces fit status because real-time market data can be sparse, stale, crossed, or inconsistent across exchanges. Fit diagnostics should help operators decide whether the SVI volatility surface is usable for pricing, analytics, or external display.

Important fit signals:

- Current fit status and last fit status.
- Elapsed fit time.
- Time since the last successful surface update.
- Risk reversal and fly consistency by expiry.
- Quotes that sit through the fitted SVI curve.
- Missing or stale implied volatility points.
- Exchange disagreement across Deribit, Binance, OKX, and other venues.

## Variance Lines And G-Test

SVI calibration is performed in total implied variance space. The variance lines shown in the Fit tab are therefore the native fitted objects: each line represents one expiry across log-moneyness. The volatility view is a transformed presentation of the same fit for users who think in implied-volatility points.

The g-test series is a fit-quality and no-arbitrage diagnostic published by the upstream engine. It is used to monitor whether a fitted SVI smile is drifting toward butterfly-arbitrage issues such as invalid local convexity or suspicious wing behavior. Operators should read g-test movement together with fit error, stale quote state, crossed markets, and quote-through-fit panels rather than treating it as a standalone trading signal.

## Underlying Handling

SVI fitting is underlying-scoped upstream. BTC, ETH, and altcoin options can have separate smiles, surfaces, risk reversal nodes, and websocket ingestion state in the pricing engine, while this frontend consumes the active surface feed exposed by the old API contract.

## UI Contract

The preferred API contract sends schema version `1` messages with per-expiry smiles, `x_axis`, `var`, `vol`, implied volatility points, risk reversal nodes, fly nodes, and tenor rows. The browser merges snapshots and patches, then renders the latest available SVI volatility surface without assuming that every exchange or currency is present on every update.
