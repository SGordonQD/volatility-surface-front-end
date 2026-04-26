import {
  memo,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from "react";

import "./App.css";
import { MiniSmileCanvasChart, SmileCanvasChart, VarianceCanvasChart } from "./components/CanvasCharts";
import { Surface3DCanvas } from "./components/Surface3DCanvas";
import {
  buildGTestSeries,
  buildGTestYDomain,
  buildSurfaceGrid,
  buildSmileThroughMatrix,
  buildSmileChartRows,
  buildTicks,
  buildVarianceSeries,
  buildVarianceXDomain,
  buildVarianceYDomain,
  chooseTickStep,
  FITTED_CURVE_COLOR,
  formatTs,
  safeDomain,
  safeNumber,
  snapDown,
  snapUp,
} from "./lib/svi-charting";
import { useSviFeed } from "./hooks/useSviFeed";
import type {
  CurveRow,
  FlyByExpiry,
  FlyState,
  QuotesByExpiry,
  RiskReversalByExpiry,
  RiskReversalNode,
  RiskReversalState,
  ScatterRow,
  SmileChartRow,
  TenorByKey,
} from "./lib/svi-types";

function Card({
  children,
  className = "",
  style,
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <div className={`terminal-card ${className}`.trim()} style={style}>
      {children}
    </div>
  );
}

function useContainerWidth(ref: RefObject<HTMLDivElement | null>) {
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        setWidth(entry.contentRect.width);
      }
    });

    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);

  return width;
}

function useViewportHeight() {
  const [height, setHeight] = useState(() => window.innerHeight);

  useEffect(() => {
    const handleResize = () => setHeight(window.innerHeight);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  return height;
}

function getColumnCount(width: number) {
  if (width >= 1000) return 3;
  if (width >= 600) return 2;
  return 1;
}

const DISCLAIMER_ACK_KEY = "SVI_DISCLAIMER_ACK_V1";
const DAYS_FALLBACK_NOW_MS = Date.now();

type RuntimeDebugSnapshot = {
  connected: boolean | null;
  droppedMessages: number | null;
  heapUsedMb: number | null;
  lastFlushMs: number | null;
  lastFrameMs: number | null;
  lastKind: string | null;
  maxFrameMs: number | null;
  maxPendingQueue: number | null;
  mountedSmileCharts: number;
  pendingQueue: number | null;
  receivedMessages: number | null;
  visibleSmileCharts: number;
};

function isSviRuntimeDebugEnabled() {
  try {
    const params = new URLSearchParams(window.location.search);
    return localStorage.getItem("SVI_DEBUG") === "1" || params.get("sviDebug") === "1";
  } catch {
    return false;
  }
}

function readDebugNumber(source: Record<string, unknown> | undefined, key: string) {
  const value = source?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readRuntimeDebugSnapshot({
  mountedSmileCharts,
  visibleSmileCharts,
}: {
  mountedSmileCharts: number;
  visibleSmileCharts: number;
}): RuntimeDebugSnapshot {
  const target = window as Window & {
    __SVI_DEBUG__?: Record<string, unknown>;
    __SVI_RENDER_DEBUG__?: Record<string, unknown>;
  };
  const feedDebug = target.__SVI_DEBUG__;
  const renderDebug = target.__SVI_RENDER_DEBUG__;
  const memory = (performance as Performance & { memory?: { usedJSHeapSize?: number } }).memory;
  const heapFromPerf =
    memory?.usedJSHeapSize != null && Number.isFinite(memory.usedJSHeapSize)
      ? memory.usedJSHeapSize / 1024 / 1024
      : null;

  return {
    connected: typeof feedDebug?.connected === "boolean" ? feedDebug.connected : null,
    droppedMessages: readDebugNumber(feedDebug, "droppedMessages"),
    heapUsedMb: readDebugNumber(feedDebug, "heapUsedMb") ?? heapFromPerf,
    lastFlushMs: readDebugNumber(feedDebug, "lastFlushMs"),
    lastFrameMs: readDebugNumber(renderDebug, "lastFrameMs"),
    lastKind: typeof renderDebug?.lastKind === "string" ? renderDebug.lastKind : null,
    maxFrameMs: readDebugNumber(renderDebug, "maxFrameMs"),
    maxPendingQueue: readDebugNumber(feedDebug, "maxPendingQueue"),
    mountedSmileCharts,
    pendingQueue: readDebugNumber(feedDebug, "pendingQueue"),
    receivedMessages: readDebugNumber(feedDebug, "receivedMessages"),
    visibleSmileCharts,
  };
}

function RuntimeDebugPanel({
  mountedSmileCharts,
  visibleSmileCharts,
}: {
  mountedSmileCharts: number;
  visibleSmileCharts: number;
}) {
  const [enabled] = useState(isSviRuntimeDebugEnabled);
  const [snapshot, setSnapshot] = useState<RuntimeDebugSnapshot | null>(() =>
    isSviRuntimeDebugEnabled() ? readRuntimeDebugSnapshot({ mountedSmileCharts, visibleSmileCharts }) : null
  );

  useEffect(() => {
    if (!enabled) return;

    const update = () => {
      setSnapshot(readRuntimeDebugSnapshot({ mountedSmileCharts, visibleSmileCharts }));
    };
    const frameId = window.requestAnimationFrame(update);
    const intervalId = window.setInterval(update, 1_000);
    return () => {
      window.cancelAnimationFrame(frameId);
      window.clearInterval(intervalId);
    };
  }, [enabled, mountedSmileCharts, visibleSmileCharts]);

  if (!enabled || snapshot == null) return null;

  return (
    <aside className="runtime-debug" aria-label="SVI runtime debug">
      <div className="runtime-debug__title">SVI Debug</div>
      <div className="runtime-debug__grid">
        <span>conn</span>
        <strong>{snapshot.connected == null ? "?" : snapshot.connected ? "on" : "off"}</strong>
        <span>queue</span>
        <strong>{snapshot.pendingQueue ?? "—"}</strong>
        <span>max q</span>
        <strong>{snapshot.maxPendingQueue ?? "—"}</strong>
        <span>heap</span>
        <strong>{snapshot.heapUsedMb == null ? "—" : `${snapshot.heapUsedMb.toFixed(1)}MB`}</strong>
        <span>charts</span>
        <strong>
          {snapshot.visibleSmileCharts}/{snapshot.mountedSmileCharts}
        </strong>
        <span>frame</span>
        <strong>{snapshot.lastFrameMs == null ? "—" : `${snapshot.lastFrameMs.toFixed(1)}ms`}</strong>
        <span>max frame</span>
        <strong>{snapshot.maxFrameMs == null ? "—" : `${snapshot.maxFrameMs.toFixed(1)}ms`}</strong>
        <span>kind</span>
        <strong>{snapshot.lastKind ?? "—"}</strong>
        <span>flush</span>
        <strong>{snapshot.lastFlushMs == null ? "—" : `${snapshot.lastFlushMs.toFixed(1)}ms`}</strong>
        <span>recv/drop</span>
        <strong>
          {snapshot.receivedMessages ?? "—"}/{snapshot.droppedMessages ?? "—"}
        </strong>
      </div>
    </aside>
  );
}

function useVirtualGrid({
  itemCount,
  itemHeight,
  containerRef,
  overscan = 2,
}: {
  itemCount: number;
  itemHeight: number;
  containerRef: RefObject<HTMLDivElement | null>;
  overscan?: number;
}) {
  const [range, setRange] = useState<[number, number]>([0, 10]);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;

    const handleScroll = () => {
      const scrollTop = element.scrollTop;
      const height = element.clientHeight;

      const start = Math.floor(scrollTop / itemHeight) - overscan;
      const end = Math.ceil((scrollTop + height) / itemHeight) + overscan;
      setRange([Math.max(0, start), Math.min(itemCount, end)]);
    };

    handleScroll();
    element.addEventListener("scroll", handleScroll, { passive: true });
    return () => element.removeEventListener("scroll", handleScroll);
  }, [containerRef, itemCount, itemHeight, overscan]);

  return range;
}

function DashboardHeader({
  connected,
  currentFitError,
  lastFitError,
  lastFitElapsedSeconds,
  lastSnapshotUpdated,
  reconnectAttempt,
  snapshotCcy,
  snapshotKind,
  smileCount,
  tradeAlert,
  tradeAlertVisible,
}: {
  connected: boolean;
  currentFitError: number | null;
  lastFitError: number | null;
  lastFitElapsedSeconds: number | null;
  lastSnapshotUpdated: number | null;
  reconnectAttempt: number;
  snapshotCcy: string;
  snapshotKind: string;
  smileCount: number;
  tradeAlert: { id: number; message: string } | null;
  tradeAlertVisible: boolean;
}) {
  const currentFitClass =
    currentFitError != null && lastFitError != null
      ? currentFitError > lastFitError
        ? "metric-card__value metric-card__value--up"
        : "metric-card__value metric-card__value--down"
      : "metric-card__value";

  return (
    <header className="app-toolbar">
      <div className="app-toolbar__inner">
        <div className="app-toolbar__identity">
          <div className="brand-lockup">
            <svg
              className="brand-lockup__mark"
              viewBox="0 0 64 64"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              aria-label="Derivasys logo"
              role="img"
            >
              <rect x="4" y="4" width="56" height="56" stroke="#4f669f" strokeWidth="4" />
              <path
                d="M14 42L28 28L39 39L53 25"
                stroke="#4f669f"
                strokeWidth="4"
                strokeLinecap="square"
                strokeLinejoin="miter"
              />
              <path d="M45 25H53V33" stroke="#4f669f" strokeWidth="4" strokeLinecap="square" />
            </svg>

            <div className="brand-lockup__text">
              <div className="brand-lockup__eyebrow">Surface Monitor</div>
              <h1 className="app-toolbar__title">Derivasys</h1>
              <p className="app-toolbar__subtitle">
                Dense live view of fitted variance and quoted smile structure.
              </p>
            </div>
          </div>

          <div className="app-toolbar__meta">
            <span className={`terminal-pill ${connected ? "terminal-pill--ok" : "terminal-pill--warn"}`}>
              <span className="terminal-pill__dot" />
              {connected ? "Feed Online" : "Feed Offline"}
            </span>
            <span className="terminal-pill terminal-pill--dim">{snapshotCcy}</span>
            <span className="terminal-pill terminal-pill--dim">{snapshotKind}</span>
            <span className="terminal-pill terminal-pill--dim">{smileCount} smiles</span>
            {!connected && reconnectAttempt > 0 ? (
              <span className="terminal-pill terminal-pill--warn">retry #{reconnectAttempt}</span>
            ) : null}
          </div>
        </div>

        <div className="app-toolbar__stats">
          <div className="metric-card">
            <span className="metric-card__label">SVI Push</span>
            <span className="metric-card__value">{formatTs(lastSnapshotUpdated)}</span>
          </div>
          <div className="metric-card">
            <span className="metric-card__label">Last Fit</span>
            <span className="metric-card__value metric-card__value--accent">
              {lastFitError != null ? lastFitError.toFixed(4) : "—"}
            </span>
          </div>
          <div className="metric-card">
            <span className="metric-card__label">Current Fit</span>
            <span className={currentFitClass}>
              {currentFitError != null ? currentFitError.toFixed(4) : "—"}
            </span>
          </div>
          <div className="metric-card">
            <span className="metric-card__label">Fit Time</span>
            <span className="metric-card__value">
              {lastFitElapsedSeconds != null ? `${lastFitElapsedSeconds.toFixed(2)}s` : "—"}
            </span>
          </div>
          <div className="metric-card">
            <span className="metric-card__label">Feed State</span>
            <span
              className={`metric-card__value ${
                connected ? "metric-card__value--down" : "metric-card__value--up"
              }`}
            >
              {connected ? "steady" : "waiting"}
            </span>
          </div>
        </div>
      </div>
      {tradeAlert ? (
        <div className="app-toolbar__notice">
          <div className={`trade-alert ${tradeAlertVisible ? "is-visible" : ""}`} role="status" aria-live="polite">
            {tradeAlert.message}
          </div>
        </div>
      ) : null}
    </header>
  );
}

function FirstVisitDisclaimer({ onAcknowledge }: { onAcknowledge: () => void }) {
  return (
    <div className="disclaimer-overlay" role="presentation">
      <div className="disclaimer-modal" role="dialog" aria-modal="true" aria-labelledby="disclaimer-title">
        <div className="disclaimer-modal__eyebrow">Important Notice</div>
        <h2 id="disclaimer-title" className="disclaimer-modal__title">
          Data Quality & GDPR Disclaimer
        </h2>
        <p className="disclaimer-modal__copy">
          This interface is for monitoring and operational use only. Quotes, fitted values, and analytics may be
          delayed, incomplete, or inaccurate and can change without notice.
        </p>
        <p className="disclaimer-modal__copy">
          Under GDPR, this service may process personal data such as technical identifiers (for example IP address,
          device/browser metadata, and usage logs) for security, reliability, and service operation.
        </p>
        <p className="disclaimer-modal__copy">
          By continuing, you acknowledge these limitations, that this is not investment advice, and that data should be
          independently validated before trading or risk decisions.
        </p>
        <div className="disclaimer-modal__actions">
          <button type="button" className="disclaimer-modal__button" onClick={onAcknowledge}>
            I Understand
          </button>
        </div>
      </div>
    </div>
  );
}

function formatAtm(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "ATM --";
  return `ATM ${new Intl.NumberFormat("en-GB", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)}`;
}

function formatAtmNumber(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en-GB", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatStrike(value: number) {
  return new Intl.NumberFormat("en-GB", {
    maximumFractionDigits: 0,
  }).format(value);
}

function DeribitExchangeMark() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="exchange-mark exchange-mark--deribit"
      role="img"
      aria-label="Deribit"
    >
      <rect x="2" y="4" width="2.6" height="16" fill="currentColor" />
      <rect x="2" y="8" width="7.5" height="2.6" fill="currentColor" />
      <rect x="2" y="13.4" width="7.5" height="2.6" fill="currentColor" />
      <path
        d="M8 5.2h2.8c5.7 0 9.2 2.8 9.2 6.8s-3.5 6.8-9.2 6.8H8v-2.6h2.8c4.3 0 6.3-1.9 6.3-4.2s-2-4.2-6.3-4.2H8z"
        fill="currentColor"
      />
    </svg>
  );
}

function OkxExchangeMark() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="exchange-mark exchange-mark--okx"
      role="img"
      aria-label="OKX"
    >
      <rect x="1" y="7" width="4" height="4" fill="currentColor" />
      <rect x="5.5" y="7" width="4" height="4" fill="currentColor" />
      <rect x="10" y="7" width="4" height="4" fill="currentColor" />
      <rect x="14.5" y="7" width="4" height="4" fill="currentColor" />
      <rect x="5.5" y="11.5" width="4" height="4" fill="currentColor" />
      <rect x="10" y="11.5" width="4" height="4" fill="currentColor" />
      <rect x="14.5" y="11.5" width="4" height="4" fill="currentColor" />
      <rect x="19" y="7" width="4" height="4" fill="currentColor" />
    </svg>
  );
}

function SmileExchangeBadges({
  hasDeribit,
  hasOkx,
}: {
  hasDeribit: boolean;
  hasOkx: boolean;
}) {
  if (!hasDeribit && !hasOkx) return null;
  return (
    <div className="smile-exchange-badges" aria-label="Available exchanges">
      {hasDeribit ? (
        <span className="smile-exchange-badge smile-exchange-badge--deribit" title="Deribit">
          <DeribitExchangeMark />
        </span>
      ) : null}
      {hasOkx ? (
        <span className="smile-exchange-badge smile-exchange-badge--okx" title="OKX">
          <OkxExchangeMark />
        </span>
      ) : null}
    </div>
  );
}

type SmileXAxisMode = "log_moneyness" | "strike";
type ExchangeVisibility = {
  deribit: boolean;
  okx: boolean;
};

function applyExchangeVisibility(row: SmileChartRow, visibility: ExchangeVisibility): SmileChartRow {
  const rowBidScatter = row.bidScatter ?? [];
  const rowAskScatter = row.askScatter ?? [];
  const rowBestBidScatter = row.bestBidScatter ?? [];
  const rowBestAskScatter = row.bestAskScatter ?? [];
  const rowOkxScatter = row.okxScatter ?? [];
  const bidScatter = visibility.deribit ? rowBidScatter : [];
  const askScatter = visibility.deribit ? rowAskScatter : [];
  const okxScatter = visibility.okx ? rowOkxScatter : [];

  const visibleSizes = [...bidScatter, ...askScatter, ...okxScatter]
    .map((point) => point.size)
    .filter((size): size is number => size != null && Number.isFinite(size) && size > 0);

  return {
    ...row,
    bidScatter: visibility.deribit ? rowBidScatter : [],
    askScatter: visibility.deribit ? rowAskScatter : [],
    bestBidScatter: visibility.deribit ? rowBestBidScatter : [],
    bestAskScatter: visibility.deribit ? rowBestAskScatter : [],
    okxScatter,
    maxVisibleSize: visibleSizes.length ? Math.max(...visibleSizes) : 1,
  };
}

function chooseNiceStep(range: number, targetTicks = 6) {
  if (!Number.isFinite(range) || range <= 0) return 1;
  const ideal = range / Math.max(1, targetTicks);
  const exponent = Math.floor(Math.log10(ideal));
  const magnitude = Math.pow(10, exponent);
  const fraction = ideal / magnitude;

  let niceFraction = 10;
  if (fraction <= 1) niceFraction = 1;
  else if (fraction <= 2) niceFraction = 2;
  else if (fraction <= 2.5) niceFraction = 2.5;
  else if (fraction <= 5) niceFraction = 5;

  return niceFraction * magnitude;
}

function inferSmileReferencePrice(row: SmileChartRow): number | null {
  const directCandidates = [row.atm, row.lastTradePrice].filter(
    (value): value is number => value != null && Number.isFinite(value) && value > 0
  );
  if (directCandidates.length > 0) {
    return directCandidates[0];
  }

  const strikes = [
    ...row.bidScatter.map((point) => safeNumber((point as unknown as { strike?: unknown }).strike)),
    ...row.askScatter.map((point) => safeNumber((point as unknown as { strike?: unknown }).strike)),
    ...(row.okxScatter ?? []).map((point) => safeNumber((point as unknown as { strike?: unknown }).strike)),
    ...row.bestBidScatter.map((point) => safeNumber((point as unknown as { strike?: unknown }).strike)),
    ...row.bestAskScatter.map((point) => safeNumber((point as unknown as { strike?: unknown }).strike)),
    ...row.lastTradeScatter.map((point) => safeNumber((point as unknown as { strike?: unknown }).strike)),
  ].filter((value): value is number => value != null && Number.isFinite(value) && value > 0);

  if (strikes.length === 0) return null;
  strikes.sort((a, b) => a - b);
  return strikes[Math.floor(strikes.length / 2)];
}

function toStrikeScatter(
  scatter: ScatterRow[],
  referencePrice: number,
  mappingPoints: StrikeMappingPoint[]
): ScatterRow[] {
  return scatter.flatMap((point) => {
    const strikeValue = safeNumber((point as unknown as { strike?: unknown }).strike);
    const x =
      strikeValue != null && strikeValue > 0
        ? strikeValue
        : strikeFromLogMoneyness(point.x, mappingPoints, referencePrice);
    if (!Number.isFinite(x) || x <= 0) return [];
    return [{ ...point, x }];
  });
}

type StrikeMappingPoint = {
  x: number;
  strike: number;
};

function collectStrikeMappingPoints(row: SmileChartRow): StrikeMappingPoint[] {
  const allPoints = [
    ...row.bidScatter,
    ...row.askScatter,
    ...(row.okxScatter ?? []),
    ...row.bestBidScatter,
    ...row.bestAskScatter,
    ...row.lastTradeScatter,
  ];

  const deduped = new Map<number, number>();
  for (const point of allPoints) {
    const strikeValue = safeNumber((point as unknown as { strike?: unknown }).strike);
    if (strikeValue == null || !Number.isFinite(strikeValue) || strikeValue <= 0) continue;
    if (!Number.isFinite(point.x)) continue;
    deduped.set(point.x, strikeValue);
  }

  return [...deduped.entries()]
    .map(([x, strike]) => ({ x, strike }))
    .sort((a, b) => a.x - b.x);
}

function strikeFromLogMoneyness(
  x: number,
  mappingPoints: StrikeMappingPoint[],
  referencePrice: number
) {
  if (!Number.isFinite(x)) return referencePrice;
  if (mappingPoints.length === 0) return referencePrice * Math.exp(x);
  if (mappingPoints.length === 1) return mappingPoints[0].strike;

  if (x <= mappingPoints[0].x) {
    const left = mappingPoints[0];
    const right = mappingPoints[1];
    const span = right.x - left.x;
    if (!Number.isFinite(span) || Math.abs(span) < 1e-8) return left.strike;
    const t = (x - left.x) / span;
    return left.strike + (right.strike - left.strike) * t;
  }

  const lastIdx = mappingPoints.length - 1;
  if (x >= mappingPoints[lastIdx].x) {
    const left = mappingPoints[lastIdx - 1];
    const right = mappingPoints[lastIdx];
    const span = right.x - left.x;
    if (!Number.isFinite(span) || Math.abs(span) < 1e-8) return right.strike;
    const t = (x - left.x) / span;
    return left.strike + (right.strike - left.strike) * t;
  }

  for (let idx = 1; idx < mappingPoints.length; idx += 1) {
    const left = mappingPoints[idx - 1];
    const right = mappingPoints[idx];
    if (x < left.x || x > right.x) continue;

    const span = right.x - left.x;
    if (!Number.isFinite(span) || Math.abs(span) < 1e-8) return left.strike;
    const t = (x - left.x) / span;
    return left.strike + (right.strike - left.strike) * t;
  }

  return referencePrice * Math.exp(x);
}

function toStrikeCurve(
  curveData: CurveRow[],
  referencePrice: number,
  mappingPoints: StrikeMappingPoint[]
): CurveRow[] {
  return curveData.map((point) => ({
    ...point,
    x: strikeFromLogMoneyness(point.x, mappingPoints, referencePrice),
  }));
}

function selectCurveWindowForStrikeProjection(row: SmileChartRow): CurveRow[] {
  const [domainMin, domainMax] = row.xDomain;
  if (!Number.isFinite(domainMin) || !Number.isFinite(domainMax) || domainMin >= domainMax) {
    return row.curveData;
  }

  const domainPad = Math.max((domainMax - domainMin) * 0.12, 0.02);
  const minX = domainMin - domainPad;
  const maxX = domainMax + domainPad;
  const windowed = row.curveData.filter(
    (point) => Number.isFinite(point.x) && point.x >= minX && point.x <= maxX
  );

  return windowed.length >= 3 ? windowed : row.curveData;
}

function projectSmileRowXAxis(row: SmileChartRow, mode: SmileXAxisMode): SmileChartRow {
  if (mode === "log_moneyness") return row;

  const referencePrice = inferSmileReferencePrice(row);
  if (referencePrice == null) return row;
  const atmStrike = safeNumber(row.atm) ?? referencePrice;

  const strikeMappingPoints = collectStrikeMappingPoints(row);
  const curveSource = selectCurveWindowForStrikeProjection(row);
  const curveData = toStrikeCurve(curveSource, referencePrice, strikeMappingPoints);
  const bidScatter = toStrikeScatter(row.bidScatter, referencePrice, strikeMappingPoints);
  const askScatter = toStrikeScatter(row.askScatter, referencePrice, strikeMappingPoints);
  const okxScatter = toStrikeScatter(row.okxScatter ?? [], referencePrice, strikeMappingPoints);
  const bestBidScatter = toStrikeScatter(row.bestBidScatter, referencePrice, strikeMappingPoints);
  const bestAskScatter = toStrikeScatter(row.bestAskScatter, referencePrice, strikeMappingPoints);
  const lastTradeScatter = toStrikeScatter(row.lastTradeScatter, referencePrice, strikeMappingPoints);

  const scatterXValues = [
    ...bidScatter.map((point) => point.x),
    ...askScatter.map((point) => point.x),
    ...okxScatter.map((point) => point.x),
    ...bestBidScatter.map((point) => point.x),
    ...bestAskScatter.map((point) => point.x),
    ...lastTradeScatter.map((point) => point.x),
  ].filter((value) => Number.isFinite(value) && value > 0);

  const xValues = [
    ...scatterXValues,
    atmStrike,
    ...curveData
      .filter((point): point is { x: number; y: number } => point.y != null && Number.isFinite(point.y))
      .map((point) => point.x),
  ].filter((value) => Number.isFinite(value) && value > 0);

  if (xValues.length === 0) {
    return {
      ...row,
      curveData,
      bidScatter,
      askScatter,
      okxScatter,
      bestBidScatter,
      bestAskScatter,
      lastTradeScatter,
      atmX: atmStrike,
    };
  }

  const domainSource = scatterXValues.length >= 3 ? [...scatterXValues, atmStrike] : xValues;
  const minX = Math.min(...domainSource);
  const maxX = Math.max(...domainSource);
  const pad = Math.max((maxX - minX) * 0.06, 25);
  const rawDomainMin = Math.max(0, minX - pad);
  const rawDomainMax = Math.max(rawDomainMin + 1, maxX + pad);
  const initialStep = chooseNiceStep(rawDomainMax - rawDomainMin, 5);

  let xStep = initialStep;
  let xDomain = safeDomain(
    Math.floor(rawDomainMin / xStep) * xStep,
    Math.ceil(rawDomainMax / xStep) * xStep,
    row.xDomain
  );
  let xTicks = buildTicks(xDomain[0], xDomain[1], xStep);

  while (xTicks.length > 8) {
    xStep *= 2;
    xDomain = safeDomain(
      Math.floor(rawDomainMin / xStep) * xStep,
      Math.ceil(rawDomainMax / xStep) * xStep,
      row.xDomain
    );
    xTicks = buildTicks(xDomain[0], xDomain[1], xStep);
  }

  return {
    ...row,
    curveData,
    bidScatter,
    askScatter,
    okxScatter,
    bestBidScatter,
    bestAskScatter,
    lastTradeScatter,
    xDomain,
    xTicks,
    atmX: atmStrike,
  };
}

function smoothVarianceDomain(previous: [number, number], next: [number, number]): [number, number] {
  const previousRange = previous[1] - previous[0];
  const nextRange = next[1] - next[0];
  if (
    !Number.isFinite(previousRange) ||
    !Number.isFinite(nextRange) ||
    previousRange <= 0 ||
    nextRange <= 0
  ) {
    return next;
  }

  const rangeRatio = Math.max(previousRange, nextRange) / Math.min(previousRange, nextRange);
  if (!Number.isFinite(rangeRatio) || rangeRatio > 2.25) {
    return next;
  }

  const shrinkBlend = 0.42;
  const min =
    next[0] < previous[0]
      ? next[0]
      : previous[0] + (next[0] - previous[0]) * shrinkBlend;
  const max =
    next[1] > previous[1]
      ? next[1]
      : previous[1] + (next[1] - previous[1]) * shrinkBlend;

  return safeDomain(snapDown(min, 0.005), snapUp(max, 0.005), next);
}

function formatSurfaceTimestamp(ts: number | null | undefined) {
  if (ts == null || !Number.isFinite(ts)) return "—";
  try {
    return new Intl.DateTimeFormat("en-GB", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).format(new Date(ts));
  } catch {
    return formatTs(ts);
  }
}

function formatGTestUnit(unit: string | null | undefined) {
  if (!unit) return "—";
  if (unit === "percent_probability_space") return "percent prob space";
  return unit.replace(/_/g, " ");
}

function SmileAtmBadge({ atm, className = "" }: { atm: number | null | undefined; className?: string }) {
  const [flashClass, setFlashClass] = useState("");
  const previousAtmRef = useRef<number | null>(null);

  useEffect(() => {
    if (atm == null || !Number.isFinite(atm)) return;

    const previousAtm = previousAtmRef.current;
    previousAtmRef.current = atm;

    if (previousAtm == null || previousAtm === atm) return;

    const nextClass = atm > previousAtm ? "smile-atm--up" : "smile-atm--down";
    let timeoutId: number | null = null;
    const frameId = window.requestAnimationFrame(() => {
      setFlashClass(nextClass);
      timeoutId = window.setTimeout(() => setFlashClass(""), 520);
    });
    return () => {
      window.cancelAnimationFrame(frameId);
      if (timeoutId != null) window.clearTimeout(timeoutId);
    };
  }, [atm]);

  return (
    <div className={`smile-atm ${flashClass} ${className}`.trim()}>
      {formatAtm(atm)}
    </div>
  );
}

function VariancePanel({
  hoverX,
  onHoverX,
  scaleMode,
  onScaleModeChange,
  series,
  snapshotKind,
  snapshotCcy,
  smileCount,
  varHeight,
  xDomain,
  xTicks,
  yDomain,
  yTicks,
  expanded = false,
  onExpand,
  onCollapse,
}: {
  hoverX: number | null;
  onHoverX: (x: number | null) => void;
  scaleMode: "auto" | "focus" | "tight";
  onScaleModeChange: (mode: "auto" | "focus" | "tight") => void;
  series: ReturnType<typeof buildVarianceSeries>;
  snapshotKind: string;
  snapshotCcy: string;
  smileCount: number;
  varHeight: number;
  xDomain: [number, number];
  xTicks: number[];
  yDomain: [number, number];
  yTicks: number[];
  expanded?: boolean;
  onExpand?: () => void;
  onCollapse?: () => void;
}) {
  const handleToggle = expanded ? onCollapse : onExpand;
  return (
    <div className={`overview-panel ${expanded ? "overview-panel--expanded" : ""}`.trim()} style={{ minWidth: 0 }}>
      <Card className={`overview-card ${handleToggle ? "overview-card--expandable" : ""}`.trim()}>
        <div className="panel-heading">
          <h3 className="panel-heading__title">Variance</h3>
          <div className="panel-heading__controls">
            <div className="scale-toggle" role="group" aria-label="Variance scale mode">
              <button
                type="button"
                className={`scale-toggle__button ${scaleMode === "focus" ? "is-active" : ""}`}
                onClick={() => onScaleModeChange("focus")}
              >
                -2 to +2
              </button>
              <button
                type="button"
                className={`scale-toggle__button ${scaleMode === "tight" ? "is-active" : ""}`}
                onClick={() => onScaleModeChange("tight")}
              >
                -1 to +1
              </button>
              <button
                type="button"
                className={`scale-toggle__button ${scaleMode === "auto" ? "is-active" : ""}`}
                onClick={() => onScaleModeChange("auto")}
              >
                Auto
              </button>
            </div>
            <div className="panel-heading__meta">
              {snapshotCcy} / {snapshotKind} / {smileCount} smiles
            </div>
            {handleToggle ? (
              <button
                type="button"
                className={`panel-expand-button ${expanded ? "is-active" : ""}`.trim()}
                onClick={handleToggle}
              >
                {expanded ? "Collapse" : "Expand"}
              </button>
            ) : null}
          </div>
        </div>

        <VarianceCanvasChart
          height={varHeight}
          xLabel={snapshotKind === "x" ? "log-moneyness" : snapshotKind}
          series={series}
          xDomain={xDomain}
          yDomain={yDomain}
          xTicks={xTicks}
          yTicks={yTicks}
          hoverX={hoverX}
          onHoverX={onHoverX}
          onActivate={expanded ? undefined : onExpand}
        />
      </Card>
    </div>
  );
}

function Surface3DPanel({
  grid,
  mode,
  onModeChange,
  height,
  smileCount,
  snapshotTs,
  expanded = false,
  onExpand,
  onCollapse,
}: {
  grid: ReturnType<typeof buildSurfaceGrid>;
  mode: "vol" | "var";
  onModeChange: (mode: "vol" | "var") => void;
  height: number;
  smileCount: number;
  snapshotTs: number | null | undefined;
  expanded?: boolean;
  onExpand?: () => void;
  onCollapse?: () => void;
}) {
  const timestampText = formatSurfaceTimestamp(snapshotTs);
  const title = `${mode === "vol" ? "Volatility" : "Variance"} Surface`;
  const handleToggle = expanded ? onCollapse : onExpand;
  return (
    <div className={`overview-panel ${expanded ? "overview-panel--expanded" : ""}`.trim()} style={{ minWidth: 0 }}>
      <Card className={`overview-card surface-3d-card ${handleToggle ? "overview-card--expandable" : ""}`.trim()}>
        <div className="surface-3d-panel-head">
          <div className="surface-3d-panel-copy">
            <h3 className="surface-3d-panel-title">{title}</h3>
            <div className="surface-3d-panel-subtitle">Timestamp: {timestampText}</div>
          </div>
          <div className="surface-3d-panel-controls">
            <div className="scale-toggle" role="group" aria-label="3D surface mode">
              <button
                type="button"
                className={`scale-toggle__button ${mode === "vol" ? "is-active" : ""}`}
                onClick={() => onModeChange("vol")}
              >
                Vol
              </button>
              <button
                type="button"
                className={`scale-toggle__button ${mode === "var" ? "is-active" : ""}`}
                onClick={() => onModeChange("var")}
              >
                Var
              </button>
            </div>
            <div className="surface-3d-panel-meta">
              {grid?.rows.length ?? 0} of {smileCount} smiles
            </div>
            {handleToggle ? (
              <button
                type="button"
                className={`panel-expand-button ${expanded ? "is-active" : ""}`.trim()}
                onClick={handleToggle}
              >
                {expanded ? "Collapse" : "Expand"}
              </button>
            ) : null}
          </div>
        </div>

        <Surface3DCanvas grid={grid} height={height} mode={mode} onActivate={expanded ? undefined : onExpand} />
      </Card>
    </div>
  );
}

function GTestPanel({
  hoverX,
  onHoverX,
  scaleMode,
  onScaleModeChange,
  series,
  snapshotKind,
  snapshotCcy,
  smileCount,
  unit,
  height,
  xDomain,
  xTicks,
  yDomain,
  yTicks,
  expanded = false,
  onExpand,
  onCollapse,
}: {
  hoverX: number | null;
  onHoverX: (x: number | null) => void;
  scaleMode: "auto" | "focus" | "tight";
  onScaleModeChange: (mode: "auto" | "focus" | "tight") => void;
  series: ReturnType<typeof buildGTestSeries>;
  snapshotKind: string;
  snapshotCcy: string;
  smileCount: number;
  unit: string | null | undefined;
  height: number;
  xDomain: [number, number];
  xTicks: number[];
  yDomain: [number, number];
  yTicks: number[];
  expanded?: boolean;
  onExpand?: () => void;
  onCollapse?: () => void;
}) {
  const handleToggle = expanded ? onCollapse : onExpand;
  return (
    <div className={`overview-panel ${expanded ? "overview-panel--expanded" : ""}`.trim()} style={{ minWidth: 0 }}>
      <Card className={`overview-card ${handleToggle ? "overview-card--expandable" : ""}`.trim()}>
        <div className="panel-heading">
          <h3 className="panel-heading__title">G-Test</h3>
          <div className="panel-heading__controls">
            <div className="scale-toggle" role="group" aria-label="G-test scale mode">
              <button
                type="button"
                className={`scale-toggle__button ${scaleMode === "focus" ? "is-active" : ""}`}
                onClick={() => onScaleModeChange("focus")}
              >
                -2 to +2
              </button>
              <button
                type="button"
                className={`scale-toggle__button ${scaleMode === "tight" ? "is-active" : ""}`}
                onClick={() => onScaleModeChange("tight")}
              >
                -1 to +1
              </button>
              <button
                type="button"
                className={`scale-toggle__button ${scaleMode === "auto" ? "is-active" : ""}`}
                onClick={() => onScaleModeChange("auto")}
              >
                Auto
              </button>
            </div>
            <div className="panel-heading__meta">
              {snapshotCcy} / {snapshotKind} / {smileCount} smiles / {formatGTestUnit(unit)}
            </div>
            {handleToggle ? (
              <button
                type="button"
                className={`panel-expand-button ${expanded ? "is-active" : ""}`.trim()}
                onClick={handleToggle}
              >
                {expanded ? "Collapse" : "Expand"}
              </button>
            ) : null}
          </div>
        </div>

        <VarianceCanvasChart
          height={height}
          xLabel={snapshotKind === "x" ? "log-moneyness" : snapshotKind}
          yLabel="g-test %"
          series={series}
          xDomain={xDomain}
          yDomain={yDomain}
          xTicks={xTicks}
          yTicks={yTicks}
          hoverX={hoverX}
          onHoverX={onHoverX}
          onActivate={expanded ? undefined : onExpand}
          showZeroLine
          highlightNegative
          yTickFormatter={(value) => `${value.toFixed(0)}%`}
        />
      </Card>
    </div>
  );
}

type RiskFlashDirection = "up" | "down";
type RiskFlashState = { direction: RiskFlashDirection; until: number; nonce: number };
type RiskFlashByCell = Record<string, RiskFlashState>;
type RiskCategorySeries = {
  id: string;
  label: string;
  color: string;
  values: Array<number | null>;
};
type RrDaysSeries = {
  id: string;
  label: string;
  color: string;
  points: Array<{ x: number; y: number }>;
};
type NodeXAxisMode = "node" | "strike" | "log_moneyness";
type RiskRowMode = "expiry" | "tenor";
type DashboardTabKey = "market" | "fit";
type FitOverviewPanelKey = "g_test" | "variance" | "surface3d";

const RISK_FLASH_DURATION_MS = 760;
const RISK_SERIES_COLORS = [
  "#ffb454",
  "#66b3ff",
  "#7dd3a6",
  "#f28b82",
  "#c4b5fd",
  "#facc15",
  "#22d3ee",
  "#fb7185",
  "#a3e635",
  "#f9a8d4",
  "#93c5fd",
  "#34d399",
];
const RISK_DELTA_ORDER = [5, 10, 15, 20, 25, 30, 35, 40] as const;
const RISK_NODE_LABEL_ORDER = [
  ...RISK_DELTA_ORDER.map((delta) => `${delta}P`),
  "AMTF",
  ...[...RISK_DELTA_ORDER].reverse().map((delta) => `${delta}C`),
] as const;
const RISK_NODE_LABEL_RANK = new Map(
  RISK_NODE_LABEL_ORDER.map((label, index) => [label, index] as const)
);

function canonicalRiskLabel(label: string) {
  return label.trim().toUpperCase();
}

function compareRiskNodeLabels(left: string, right: string) {
  const leftCanonical = canonicalRiskLabel(left);
  const rightCanonical = canonicalRiskLabel(right);
  const leftRank = RISK_NODE_LABEL_RANK.get(leftCanonical);
  const rightRank = RISK_NODE_LABEL_RANK.get(rightCanonical);

  if (leftRank != null && rightRank != null) return leftRank - rightRank;
  if (leftRank != null) return -1;
  if (rightRank != null) return 1;
  return leftCanonical.localeCompare(rightCanonical);
}

function collectRiskNodeLabels(rows: RiskReversalState[]) {
  const byCanonical = new Map<string, string>();
  for (const row of rows) {
    for (const label of Object.keys(row.risk_reversal_nodes ?? {})) {
      const trimmed = label.trim();
      if (!trimmed) continue;
      const canonical = canonicalRiskLabel(trimmed);
      if (!byCanonical.has(canonical)) {
        byCanonical.set(canonical, trimmed);
      }
    }
  }
  return [...byCanonical.values()].sort(compareRiskNodeLabels);
}

function orderRiskNodeChartLabels(labels: string[]) {
  return [...labels].sort(compareRiskNodeLabels);
}

function collectRiskReversalLabels(rows: RiskReversalState[]) {
  const ordered: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    for (const label of Object.keys(row.risk_reversals ?? {})) {
      const trimmed = label.trim();
      if (!trimmed) continue;
      const canonical = canonicalRiskLabel(trimmed);
      if (seen.has(canonical)) continue;
      seen.add(canonical);
      ordered.push(trimmed);
    }
  }
  return ordered;
}

function formatRiskVol(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value.toFixed(2)}%`;
}

function formatRiskStrike(value: number | undefined) {
  if (value == null || !Number.isFinite(value)) return "K —";
  return `K ${new Intl.NumberFormat("en-GB", { maximumFractionDigits: 1 }).format(value)}`;
}

function formatRiskLogMoneyness(value: number | undefined) {
  if (value == null || !Number.isFinite(value)) return "x —";
  return `x ${value.toFixed(4)}`;
}

function formatNodeXAxisCategoryLabel(mode: NodeXAxisMode, rawLabel: string, value: number | null) {
  if (mode === "node") return canonicalRiskLabel(rawLabel);
  if (value == null || !Number.isFinite(value)) return "—";
  if (mode === "strike") return formatStrike(value);
  return value.toFixed(4);
}

function resolveLatestNodeMetricFromRows(
  rows: Array<{ ts?: number | null }>,
  labels: string[],
  mode: Exclude<NodeXAxisMode, "node">,
  resolveNode: (row: { ts?: number | null }, label: string) => RiskReversalNode | null
) {
  return labels.map((label) => {
    let latestTs = Number.NEGATIVE_INFINITY;
    let latestValue: number | null = null;

    for (const row of rows) {
      const node = resolveNode(row, label);
      if (!node) continue;
      const value = safeNumber(mode === "strike" ? node.strike : node.log_moneyness);
      if (value == null || !Number.isFinite(value)) continue;

      const rowTs = safeNumber((row as { ts?: unknown }).ts) ?? Number.NEGATIVE_INFINITY;
      if (rowTs >= latestTs) {
        latestTs = rowTs;
        latestValue = value;
      }
    }

    return formatNodeXAxisCategoryLabel(mode, label, latestValue);
  });
}

function formatRiskReversalLabel(value: string) {
  const normalized = value.trim();
  const rrMatch = /^rr[_\-\s]?(\d+)$/i.exec(normalized);
  if (rrMatch) return `RR${rrMatch[1]}`;
  return normalized.toUpperCase();
}

function formatRiskReversalValue(value: number | undefined | null) {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}`;
}

function toRiskReversalRows(riskReversalByExpiry: RiskReversalByExpiry) {
  return Object.values(riskReversalByExpiry)
    .slice()
    .sort((left, right) => left.expiry - right.expiry);
}

function resolveTenorSortDays(row: TenorByKey[string]) {
  const tenorDays = safeNumber(row.tenorDays);
  if (tenorDays != null && Number.isFinite(tenorDays)) return tenorDays;
  const years = safeNumber(row.days);
  if (years != null && Number.isFinite(years)) return years * 365;
  return Number.POSITIVE_INFINITY;
}

function resolveTenorRowExpiry(row: TenorByKey[string]) {
  const targetExpiry = safeNumber(row.targetExpiry);
  if (targetExpiry != null && Number.isFinite(targetExpiry)) return targetExpiry;
  const tenorDays = safeNumber(row.tenorDays);
  if (tenorDays != null && Number.isFinite(tenorDays) && tenorDays > 0) {
    return Math.round(tenorDays * 24 * 60 * 60 * 1000);
  }
  const years = safeNumber(row.days);
  if (years != null && Number.isFinite(years) && years > 0) {
    return Math.round(years * 365 * 24 * 60 * 60 * 1000);
  }
  return 0;
}

function buildRiskNodesFromTenorRow(row: TenorByKey[string]) {
  const fromVols: Record<string, RiskReversalNode> = {};
  for (const [key, value] of Object.entries(row.vols ?? {})) {
    const vol = safeNumber(value);
    if (vol == null || !Number.isFinite(vol)) continue;
    fromVols[key] = {
      label: key,
      vol,
    };
  }

  const merged: Record<string, RiskReversalNode> = {
    ...fromVols,
    ...(row.nodes ?? {}),
  };

  for (const [key, node] of Object.entries(merged)) {
    merged[key] = {
      ...node,
      label: node.label ?? key,
    };
  }

  return merged;
}

function buildRiskReversalsFromTenorRow(row: TenorByKey[string]) {
  const next: Record<string, number | null | undefined> = {};
  for (const [key, value] of Object.entries(row.rrFly ?? {})) {
    const canonical = canonicalRiskLabel(key);
    if (!canonical.startsWith("RR")) continue;
    next[key] = safeNumber(value);
  }
  return Object.keys(next).length > 0 ? next : undefined;
}

function toRiskReversalRowsFromTenors(tenorByKey: TenorByKey) {
  return Object.values(tenorByKey)
    .slice()
    .sort((left, right) => {
      const leftDays = resolveTenorSortDays(left);
      const rightDays = resolveTenorSortDays(right);
      if (leftDays !== rightDays) return leftDays - rightDays;
      const leftExpiry = resolveTenorRowExpiry(left);
      const rightExpiry = resolveTenorRowExpiry(right);
      if (leftExpiry !== rightExpiry) return leftExpiry - rightExpiry;
      return (left.tenor ?? "").localeCompare(right.tenor ?? "");
    })
    .map((row) => {
      const tenorDays = safeNumber(row.tenorDays);
      return {
        ts: row.ts ?? 0,
        expiry: resolveTenorRowExpiry(row),
        label: row.tenor,
        days: safeNumber(row.days) ?? (tenorDays != null ? tenorDays / 365 : undefined),
        risk_reversal_nodes: buildRiskNodesFromTenorRow(row),
        risk_reversals: buildRiskReversalsFromTenorRow(row),
      };
    });
}

function buildExpiryLookupCandidates(expiry: number) {
  const candidates = new Set<string>([String(expiry)]);
  if (Math.abs(expiry) < 1e11) {
    candidates.add(String(Math.round(expiry * 1000)));
  } else {
    candidates.add(String(Math.round(expiry / 1000)));
  }
  return [...candidates];
}

function findAmtfStrike(nodes: Record<string, RiskReversalNode>) {
  for (const [key, node] of Object.entries(nodes)) {
    const normalizedKey = canonicalRiskLabel(key);
    const normalizedLabel = canonicalRiskLabel(node.label ?? "");
    if (normalizedKey !== "AMTF" && normalizedLabel !== "AMTF") continue;
    const strike = safeNumber(node.strike);
    if (strike != null && Number.isFinite(strike) && strike > 0) return strike;
  }
  return null;
}

function toRiskMetricCellKey(kind: "node" | "rr", expiry: number, label: string, rowLabel?: string) {
  return `${kind}:${expiry}:${canonicalRiskLabel(rowLabel ?? "")}:${canonicalRiskLabel(label)}`;
}

function formatRiskAxisTick(value: number, asPercent: boolean) {
  if (!Number.isFinite(value)) return "—";
  if (asPercent) return `${value.toFixed(1)}%`;
  return value.toFixed(2);
}

function buildRiskCategorySeries(
  rows: RiskReversalState[],
  categoryKeys: string[],
  kind: "node" | "rr"
) {
  return rows
    .map((row, idx) => {
      const values = categoryKeys.map((key) => {
        const rawValue =
          kind === "node"
            ? resolveNodeByLabel(row.risk_reversal_nodes, key)?.vol
            : row.risk_reversals?.[key];
        const value = safeNumber(rawValue);
        return value != null && Number.isFinite(value) ? value : null;
      });
      if (!values.some((value) => value != null)) return null;

      const displayLabel = row.label ?? formatExpiryFromTs(row.expiry);
      const seriesId = `${row.expiry}:${displayLabel}`;
      return {
        id: seriesId,
        label: displayLabel,
        color: RISK_SERIES_COLORS[idx % RISK_SERIES_COLORS.length] ?? "#9fb2cb",
        values,
      } as RiskCategorySeries;
    })
    .filter((item): item is RiskCategorySeries => item != null);
}

function resolveDaysValue(days: number | undefined, expiry: number) {
  const fromMessage = safeNumber(days);
  if (fromMessage != null && Number.isFinite(fromMessage)) {
    return Math.max(0, fromMessage);
  }

  const yearsToExpiry = (expiry - DAYS_FALLBACK_NOW_MS) / (1000 * 60 * 60 * 24 * 365);
  if (!Number.isFinite(yearsToExpiry)) return null;
  return Math.max(0, yearsToExpiry);
}

function resolveRiskRowDaysValue(row: RiskReversalState) {
  return resolveDaysValue(row.days, row.expiry);
}

function buildRrDaysSeries(rows: RiskReversalState[], rrLabels: string[]) {
  return rrLabels
    .map((rrLabel, idx) => {
      const points = rows
        .map((row) => {
          const y = safeNumber(row.risk_reversals?.[rrLabel]);
          const x = resolveRiskRowDaysValue(row);
          if (y == null || !Number.isFinite(y) || x == null || !Number.isFinite(x)) return null;
          return { x, y };
        })
        .filter((point): point is { x: number; y: number } => point != null)
        .sort((left, right) => left.x - right.x);

      if (points.length === 0) return null;

      return {
        id: canonicalRiskLabel(rrLabel),
        label: formatRiskReversalLabel(rrLabel),
        color: RISK_SERIES_COLORS[idx % RISK_SERIES_COLORS.length] ?? "#9fb2cb",
        points,
      } as RrDaysSeries;
    })
    .filter((item): item is RrDaysSeries => item != null);
}

function buildFlyNodeSeries(rows: FlyState[], flyLabels: string[]) {
  return rows
    .map((row, idx) => {
      const values = flyLabels.map((flyLabel) => {
        const node = resolveNodeByLabel(row.nodes, flyLabel);
        const value = safeNumber(node?.vol);
        return value != null && Number.isFinite(value) ? value : null;
      });
      if (!values.some((value) => value != null)) return null;

      const displayLabel = row.label ?? formatExpiryFromTs(row.expiry);
      const seriesId = `${row.expiry}:${displayLabel}`;
      return {
        id: seriesId,
        label: displayLabel,
        color: RISK_SERIES_COLORS[idx % RISK_SERIES_COLORS.length] ?? "#9fb2cb",
        values,
      } as RiskCategorySeries;
    })
    .filter((item): item is RiskCategorySeries => item != null);
}

function canonicalFlyMetricLabel(label: string) {
  const normalized = label.trim().toUpperCase();
  const match = /^FLY[_\-\s]?(\d+)$/i.exec(normalized);
  if (!match) return normalized;
  return `FLY${match[1]}`;
}

function compareFlyMetricLabels(left: string, right: string) {
  const leftCanonical = canonicalFlyMetricLabel(left);
  const rightCanonical = canonicalFlyMetricLabel(right);
  const leftMatch = /^FLY(\d+)$/.exec(leftCanonical);
  const rightMatch = /^FLY(\d+)$/.exec(rightCanonical);
  if (leftMatch && rightMatch) {
    const leftWing = Number(leftMatch[1]);
    const rightWing = Number(rightMatch[1]);
    if (leftWing !== rightWing) return leftWing - rightWing;
  }
  return leftCanonical.localeCompare(rightCanonical);
}

function collectFlyMetricLabels(rows: FlyState[]) {
  const byCanonical = new Map<string, string>();
  for (const row of rows) {
    for (const key of Object.keys(row.flies ?? {})) {
      const trimmed = key.trim();
      if (!trimmed) continue;
      const canonical = canonicalFlyMetricLabel(trimmed);
      if (!canonical.startsWith("FLY")) continue;
      if (!byCanonical.has(canonical)) {
        byCanonical.set(canonical, trimmed);
      }
    }
  }
  return [...byCanonical.values()].sort(compareFlyMetricLabels);
}

function resolveFlyRowDaysValue(row: FlyState) {
  return resolveDaysValue(row.days, row.expiry);
}

function resolveFlyValueByLabel(row: FlyState, label: string) {
  const direct = safeNumber(row.flies?.[label]);
  if (direct != null && Number.isFinite(direct)) return direct;

  const target = canonicalFlyMetricLabel(label);
  for (const [key, value] of Object.entries(row.flies ?? {})) {
    if (canonicalFlyMetricLabel(key) !== target) continue;
    const parsed = safeNumber(value);
    if (parsed != null && Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function buildFlyDaysSeries(rows: FlyState[], flyMetricLabels: string[]) {
  return flyMetricLabels
    .map((flyLabel, idx) => {
      const points = rows
        .map((row) => {
          const y = resolveFlyValueByLabel(row, flyLabel);
          const x = resolveFlyRowDaysValue(row);
          if (y == null || !Number.isFinite(y) || x == null || !Number.isFinite(x)) return null;
          return { x, y };
        })
        .filter((point): point is { x: number; y: number } => point != null)
        .sort((left, right) => left.x - right.x);

      if (points.length === 0) return null;

      return {
        id: canonicalFlyMetricLabel(flyLabel),
        label: formatFlyLabel(flyLabel),
        color: RISK_SERIES_COLORS[idx % RISK_SERIES_COLORS.length] ?? "#9fb2cb",
        points,
      } as RrDaysSeries;
    })
    .filter((item): item is RrDaysSeries => item != null);
}

function buildLinearTicks(min: number, max: number, count: number) {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [];
  if (count <= 1 || max <= min) return [min, max];

  const step = (max - min) / (count - 1);
  const ticks: number[] = [];
  for (let idx = 0; idx < count; idx += 1) {
    ticks.push(min + step * idx);
  }
  return ticks;
}

function formatDayTick(value: number) {
  if (!Number.isFinite(value)) return "—";
  if (Math.abs(value) >= 10) return value.toFixed(1);
  if (Math.abs(value) >= 1) return value.toFixed(2);
  return value.toFixed(3);
}

function RrDaysChart({
  title,
  xLabel,
  yLabel,
  series,
  doubleHeight = false,
}: {
  title: string;
  xLabel: string;
  yLabel: string;
  series: RrDaysSeries[];
  doubleHeight?: boolean;
}) {
  const width = 940;
  const height = doubleHeight ? 668 : 334;
  const margin = { top: 26, right: 20, bottom: 34, left: 46 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const usableSeries = series.filter((entry) => entry.points.length > 0);

  if (usableSeries.length === 0) {
    return (
      <div className="risk-category-chart risk-category-chart--empty">
        <div className="risk-category-chart__title">{title}</div>
        <div className="risk-category-chart__empty">No data</div>
      </div>
    );
  }

  const xs = usableSeries.flatMap((entry) => entry.points.map((point) => point.x));
  const ys = usableSeries.flatMap((entry) => entry.points.map((point) => point.y));
  if (xs.length === 0 || ys.length === 0) {
    return (
      <div className="risk-category-chart risk-category-chart--empty">
        <div className="risk-category-chart__title">{title}</div>
        <div className="risk-category-chart__empty">No data</div>
      </div>
    );
  }

  const rawMinX = Math.min(...xs);
  const rawMaxX = Math.max(...xs);
  const rawXRange = rawMaxX - rawMinX;
  const xPad = rawXRange > 1e-6 ? Math.max(rawXRange * 0.06, 0.01) : 0.08;
  const minX = Math.max(0, rawMinX - xPad);
  const maxX = Math.max(minX + 1e-6, rawMaxX + xPad);
  const xRange = Math.max(1e-6, maxX - minX);

  const rawMinY = Math.min(...ys);
  const rawMaxY = Math.max(...ys);
  const rawYRange = rawMaxY - rawMinY;
  const yPad =
    rawYRange > 1e-6
      ? Math.max(rawYRange * 0.12, 0.1)
      : Math.max(0.08, Math.abs(rawMaxY) * 0.03);
  const minY = rawMinY - yPad;
  const maxY = rawMaxY + yPad;
  const yRange = Math.max(1e-6, maxY - minY);

  const toX = (value: number) => margin.left + ((value - minX) / xRange) * plotWidth;
  const toY = (value: number) => margin.top + ((maxY - value) / yRange) * plotHeight;

  const xTicks = buildLinearTicks(minX, maxX, 6);
  const yTicks = buildLinearTicks(minY, maxY, 5);

  return (
    <div className="risk-category-chart">
      <div className="risk-category-chart__title">{title}</div>
      <svg
        className="risk-category-chart__plot"
        style={{ aspectRatio: `${width} / ${height}` }}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={title}
      >
        <rect
          x={margin.left}
          y={margin.top}
          width={plotWidth}
          height={plotHeight}
          className="risk-category-chart__bg"
        />

        {xTicks.map((tick, idx) => {
          const x = toX(tick);
          return (
            <line
              key={`rr-days-x-grid-${idx}`}
              x1={x}
              y1={margin.top}
              x2={x}
              y2={margin.top + plotHeight}
              className="risk-category-chart__grid risk-category-chart__grid--x"
            />
          );
        })}

        {yTicks.map((tick, idx) => {
          const y = toY(tick);
          return (
            <g key={`rr-days-y-grid-${idx}`}>
              <line
                x1={margin.left}
                y1={y}
                x2={margin.left + plotWidth}
                y2={y}
                className="risk-category-chart__grid"
              />
              <text x={margin.left - 8} y={y + 3} textAnchor="end" className="risk-category-chart__tick">
                {formatRiskAxisTick(tick, false)}
              </text>
            </g>
          );
        })}

        {usableSeries.map((entry) => {
          const path = entry.points
            .map((point, idx) => `${idx === 0 ? "M" : "L"} ${toX(point.x).toFixed(2)} ${toY(point.y).toFixed(2)}`)
            .join(" ");
          if (!path) return null;
          return (
            <g key={entry.id}>
              <path d={path} stroke={entry.color} className="risk-category-chart__line risk-category-chart__line--glow" />
              <path d={path} stroke={entry.color} className="risk-category-chart__line" />
            </g>
          );
        })}

        {xTicks.map((tick, idx) => {
          const x = toX(tick);
          return (
            <text key={`rr-days-x-tick-${idx}`} x={x} y={margin.top + plotHeight + 14} textAnchor="middle" className="risk-category-chart__tick">
              {formatDayTick(tick)}
            </text>
          );
        })}

        {usableSeries.map((entry, idx) => {
          const legendX = margin.left + 8;
          const legendY = 10 + idx * 12;
          return (
            <g key={`rr-days-legend-${entry.id}`}>
              <line
                x1={legendX}
                y1={legendY}
                x2={legendX + 12}
                y2={legendY}
                stroke={entry.color}
                className="risk-category-chart__line"
              />
              <text x={legendX + 16} y={legendY + 3} textAnchor="start" className="risk-category-chart__tick">
                {entry.label}
              </text>
            </g>
          );
        })}

        <text
          x={margin.left + plotWidth / 2}
          y={height - 5}
          textAnchor="middle"
          className="risk-category-chart__axis-label"
        >
          {xLabel}
        </text>
        <text
          x={12}
          y={margin.top + plotHeight / 2}
          textAnchor="middle"
          transform={`rotate(-90 12 ${margin.top + plotHeight / 2})`}
          className="risk-category-chart__axis-label"
        >
          {yLabel}
        </text>
      </svg>
    </div>
  );
}

function findNearestDefinedValueIndex(values: Array<number | null>, targetIndex: number) {
  if (values.length === 0) return null;
  const clampedTarget = Math.max(0, Math.min(values.length - 1, targetIndex));
  if (values[clampedTarget] != null && Number.isFinite(values[clampedTarget])) return clampedTarget;

  for (let distance = 1; distance < values.length; distance += 1) {
    const left = clampedTarget - distance;
    const right = clampedTarget + distance;
    if (left >= 0) {
      const leftValue = values[left];
      if (leftValue != null && Number.isFinite(leftValue)) return left;
    }
    if (right < values.length) {
      const rightValue = values[right];
      if (rightValue != null && Number.isFinite(rightValue)) return right;
    }
  }
  return null;
}

function RiskCategoryChart({
  title,
  xLabel,
  yLabel,
  categories,
  series,
  yTickFormatter,
  focusedSeriesId = null,
  onSeriesFocusToggle,
  doubleHeight = false,
}: {
  title: string;
  xLabel: string;
  yLabel: string;
  categories: string[];
  series: RiskCategorySeries[];
  yTickFormatter: (value: number) => string;
  focusedSeriesId?: string | null;
  onSeriesFocusToggle?: (seriesId: string) => void;
  doubleHeight?: boolean;
}) {
  const width = 940;
  const height = doubleHeight ? 668 : 334;
  const margin = { top: 8, right: 128, bottom: 34, left: 46 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const usableSeries = series.filter((entry) => entry.values.some((value) => value != null));

  if (categories.length === 0 || usableSeries.length === 0) {
    return (
      <div className="risk-category-chart risk-category-chart--empty">
        <div className="risk-category-chart__title">{title}</div>
        <div className="risk-category-chart__empty">No data</div>
      </div>
    );
  }

  const allValues = usableSeries
    .flatMap((entry) => entry.values)
    .filter((value): value is number => value != null && Number.isFinite(value));

  if (allValues.length === 0) {
    return (
      <div className="risk-category-chart risk-category-chart--empty">
        <div className="risk-category-chart__title">{title}</div>
        <div className="risk-category-chart__empty">No data</div>
      </div>
    );
  }

  const rawMin = Math.min(...allValues);
  const rawMax = Math.max(...allValues);
  const rawRange = rawMax - rawMin;
  const pad =
    rawRange > 1e-6
      ? Math.max(rawRange * 0.08, 0.25)
      : Math.max(0.15, Math.abs(rawMax) * 0.015);
  const min = rawMin - pad;
  const max = rawMax + pad;
  const yRange = Math.max(0.25, max - min);

  const categoryDenominator = Math.max(1, categories.length - 1);
  const toX = (index: number) =>
    margin.left + (categories.length <= 1 ? plotWidth * 0.5 : (index / categoryDenominator) * plotWidth);
  const toY = (value: number) => margin.top + ((max - value) / yRange) * plotHeight;

  const yTickCount = 5;
  const yTicks = Array.from({ length: yTickCount }, (_, idx) => {
    const ratio = idx / Math.max(1, yTickCount - 1);
    return max - ratio * (max - min);
  });
  const targetAnchorIndex = Math.round((categories.length - 1) * 0.74);
  const rightLabelData = usableSeries
    .map((entry) => {
      const anchorIndex = findNearestDefinedValueIndex(entry.values, targetAnchorIndex);
      if (anchorIndex == null) return null;
      const value = entry.values[anchorIndex];
      if (value == null || !Number.isFinite(value)) return null;
      const anchorX = toX(anchorIndex);
      const anchorY = toY(value);
      return {
        id: entry.id,
        label: entry.label,
        color: entry.color,
        anchorX,
        anchorY,
        y: anchorY,
      };
    })
    .filter(
      (
        item
      ): item is { id: string; label: string; color: string; anchorX: number; anchorY: number; y: number } =>
        item != null
    );
  const placedRightLabels = (() => {
    if (rightLabelData.length === 0) return [];
    const labels = [...rightLabelData].sort((a, b) => a.y - b.y);
    const minY = margin.top + 6;
    const maxY = margin.top + plotHeight - 6;
    const availableHeight = Math.max(1, maxY - minY);
    const dynamicGap = availableHeight / Math.max(2, labels.length + 1);
    const minGap = Math.min(14, Math.max(9, dynamicGap * 0.88));

    for (let idx = 0; idx < labels.length; idx += 1) {
      const previousY = idx > 0 ? labels[idx - 1].y : minY;
      labels[idx].y = Math.max(labels[idx].y, idx === 0 ? minY : previousY + minGap);
    }

    const overflow = labels[labels.length - 1].y - maxY;
    if (overflow > 0) {
      for (let idx = labels.length - 1; idx >= 0; idx -= 1) {
        const nextY = idx < labels.length - 1 ? labels[idx + 1].y : maxY;
        labels[idx].y = Math.min(labels[idx].y - overflow, idx === labels.length - 1 ? maxY : nextY - minGap);
      }
    }

    return labels;
  })();
  const rightLabelX = width - margin.right + 8;
  const hasFocus = Boolean(focusedSeriesId);
  const isInteractive = typeof onSeriesFocusToggle === "function";

  return (
    <div className="risk-category-chart">
      <div className="risk-category-chart__title">{title}</div>
      <svg
        className="risk-category-chart__plot"
        style={{ aspectRatio: `${width} / ${height}` }}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={title}
      >
        <rect
          x={margin.left}
          y={margin.top}
          width={plotWidth}
          height={plotHeight}
          className="risk-category-chart__bg"
        />

        {categories.map((_, idx) => {
          const x = toX(idx);
          return (
            <line
              key={`x-grid-${idx}`}
              x1={x}
              y1={margin.top}
              x2={x}
              y2={margin.top + plotHeight}
              className="risk-category-chart__grid risk-category-chart__grid--x"
            />
          );
        })}

        {yTicks.map((tick) => {
          const y = toY(tick);
          return (
            <g key={`tick-${tick.toFixed(6)}`}>
              <line
                x1={margin.left}
                y1={y}
                x2={margin.left + plotWidth}
                y2={y}
                className="risk-category-chart__grid"
              />
              <text x={margin.left - 8} y={y + 3} textAnchor="end" className="risk-category-chart__tick">
                {yTickFormatter(tick)}
              </text>
            </g>
          );
        })}

        {usableSeries.map((entry) => {
          let path = "";
          let hasPath = false;
          let hasActiveSegment = false;
          const isDimmed = hasFocus && focusedSeriesId !== entry.id;
          const lineClass = `risk-category-chart__line ${isDimmed ? "risk-category-chart__line--dim" : ""}`.trim();
          const glowClass = `risk-category-chart__line risk-category-chart__line--glow ${isDimmed ? "risk-category-chart__line--dim" : ""}`.trim();

          entry.values.forEach((value, idx) => {
            if (value == null || !Number.isFinite(value)) {
              hasActiveSegment = false;
              return;
            }
            const x = toX(idx);
            const y = toY(value);
            path += `${hasActiveSegment ? " L" : `${hasPath ? " M" : "M"}`} ${x.toFixed(2)} ${y.toFixed(2)}`;
            hasPath = true;
            hasActiveSegment = true;
          });

          if (!hasPath) return null;

          return (
            <g key={entry.id}>
              <path d={path} stroke={entry.color} className={glowClass} />
              <path d={path} stroke={entry.color} className={lineClass} />
            </g>
          );
        })}

        {categories.map((label, idx) => {
          const x = toX(idx);
          return (
            <text key={`x-${label}-${idx}`} x={x} y={margin.top + plotHeight + 14} textAnchor="middle" className="risk-category-chart__tick">
              {label}
            </text>
          );
        })}

        {placedRightLabels.map((label) => {
          const textWidth = Math.max(18, label.label.length * 6.1);
          const isDimmed = hasFocus && focusedSeriesId !== label.id;
          const groupClass = `risk-category-chart__right-label-group ${
            isInteractive ? "risk-category-chart__right-label-group--interactive" : ""
          } ${isDimmed ? "risk-category-chart__right-label-group--dim" : ""}`.trim();
          return (
            <g
              key={`right-label-${label.id}`}
              className={groupClass}
              onClick={isInteractive ? () => onSeriesFocusToggle?.(label.id) : undefined}
            >
              <line
                x1={Math.min(label.anchorX + 2, margin.left + plotWidth)}
                y1={label.anchorY}
                x2={rightLabelX - 5}
                y2={label.y}
                className={`risk-category-chart__right-connector ${isDimmed ? "risk-category-chart__right-connector--dim" : ""}`.trim()}
              />
              <rect
                x={rightLabelX - 2}
                y={label.y - 6}
                width={textWidth + 4}
                height={12}
                className={`risk-category-chart__right-label-bg ${isDimmed ? "risk-category-chart__right-label-bg--dim" : ""}`.trim()}
              />
              <text
                x={rightLabelX}
                y={label.y + 3}
                textAnchor="start"
                className={`risk-category-chart__right-label ${isDimmed ? "risk-category-chart__right-label--dim" : ""}`.trim()}
                style={{ fill: label.color }}
              >
                {label.label}
              </text>
            </g>
          );
        })}

        <text
          x={margin.left + plotWidth / 2}
          y={height - 5}
          textAnchor="middle"
          className="risk-category-chart__axis-label"
        >
          {xLabel}
        </text>
        <text
          x={12}
          y={margin.top + plotHeight / 2}
          textAnchor="middle"
          transform={`rotate(-90 12 ${margin.top + plotHeight / 2})`}
          className="risk-category-chart__axis-label"
        >
          {yLabel}
        </text>
      </svg>
    </div>
  );
}

function resolveAtmByExpiryOrLabel(
  expiry: number,
  label: string | undefined,
  quotesByExpiry: QuotesByExpiry
) {
  for (const key of buildExpiryLookupCandidates(expiry)) {
    const byKey = quotesByExpiry[key];
    const atm = safeNumber(byKey?.atm);
    if (atm != null && atm > 0) return atm;
  }

  const targetLabel = (label ?? "").trim().toUpperCase();
  if (targetLabel) {
    let bestAtm: number | null = null;
    let bestTs = Number.NEGATIVE_INFINITY;

    for (const quoteState of Object.values(quotesByExpiry)) {
      const quoteLabel = (quoteState.label ?? "").trim().toUpperCase();
      if (quoteLabel !== targetLabel) continue;
      const atm = safeNumber(quoteState.atm);
      if (atm == null || atm <= 0) continue;
      if ((quoteState.ts ?? 0) > bestTs) {
        bestTs = quoteState.ts ?? 0;
        bestAtm = atm;
      }
    }

    if (bestAtm != null) return bestAtm;
  }

  return null;
}

function resolveAtmForRiskRow(row: RiskReversalState, quotesByExpiry: QuotesByExpiry) {
  const quoteAtm = resolveAtmByExpiryOrLabel(row.expiry, row.label, quotesByExpiry);
  if (quoteAtm != null) return quoteAtm;

  return findAmtfStrike(row.risk_reversal_nodes ?? {});
}

function toFlyRows(flyByExpiry: FlyByExpiry) {
  return Object.values(flyByExpiry)
    .slice()
    .sort((left, right) => left.expiry - right.expiry);
}

function buildFlyValuesFromTenorRow(row: TenorByKey[string]) {
  const next: Record<string, number | null | undefined> = {};
  for (const [key, value] of Object.entries(row.rrFly ?? {})) {
    const canonical = canonicalRiskLabel(key);
    if (!canonical.startsWith("FLY")) continue;
    next[key] = safeNumber(value);
  }
  return Object.keys(next).length > 0 ? next : undefined;
}

function toFlyRowsFromTenors(tenorByKey: TenorByKey) {
  return Object.values(tenorByKey)
    .slice()
    .sort((left, right) => {
      const leftDays = resolveTenorSortDays(left);
      const rightDays = resolveTenorSortDays(right);
      if (leftDays !== rightDays) return leftDays - rightDays;
      const leftExpiry = resolveTenorRowExpiry(left);
      const rightExpiry = resolveTenorRowExpiry(right);
      if (leftExpiry !== rightExpiry) return leftExpiry - rightExpiry;
      return (left.tenor ?? "").localeCompare(right.tenor ?? "");
    })
    .map((row) => {
      const tenorDays = safeNumber(row.tenorDays);
      return {
        ts: row.ts ?? 0,
        expiry: resolveTenorRowExpiry(row),
        label: row.tenor,
        days: safeNumber(row.days) ?? (tenorDays != null ? tenorDays / 365 : undefined),
        atm: safeNumber(row.forward),
        atmVersion: null,
        flies: buildFlyValuesFromTenorRow(row),
        nodes: buildRiskNodesFromTenorRow(row),
      };
    });
}

function collectFlyLabels(rows: FlyState[]) {
  const byCanonical = new Map<string, string>();
  for (const row of rows) {
    for (const [rawKey, rawNode] of Object.entries(row.nodes ?? {})) {
      const key = rawKey.trim();
      if (!key) continue;
      const node = rawNode as RiskReversalNode | undefined;
      const displayLabel =
        (typeof node?.label === "string" && node.label.trim()) ||
        key;
      const canonical = canonicalRiskLabel(displayLabel);
      if (!byCanonical.has(canonical)) {
        byCanonical.set(canonical, displayLabel);
      }
    }
  }
  return [...byCanonical.values()].sort(compareRiskNodeLabels);
}

function formatFlyLabel(value: string) {
  const normalized = value.trim();
  const match = /^fly[_\-\s]?(\d+)$/i.exec(normalized);
  if (match) {
    const wing = match[1];
    return `FLY${wing} (${wing}P/${wing}C)`;
  }
  return normalized.toUpperCase();
}

function formatFlyMetricLabel(value: string) {
  const normalized = value.trim();
  const match = /^fly[_\-\s]?(\d+)$/i.exec(normalized);
  if (match) return `FLY${match[1]}`;
  return normalized.toUpperCase();
}

function formatFlyMetricValue(value: number | undefined | null) {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}`;
}

function toFlyMetricCellKey(kind: "node" | "fly", expiry: number, label: string, rowLabel?: string) {
  return `fly:${kind}:${expiry}:${canonicalRiskLabel(rowLabel ?? "")}:${canonicalRiskLabel(label)}`;
}

function resolveNodeByLabel(nodes: Record<string, RiskReversalNode> | undefined, label: string) {
  if (!nodes) return null;

  const direct = nodes[label];
  if (direct) return direct;

  const target = canonicalRiskLabel(label);
  for (const [key, node] of Object.entries(nodes)) {
    if (canonicalRiskLabel(key) === target) return node;
    if (typeof node.label === "string" && canonicalRiskLabel(node.label) === target) return node;
  }
  return null;
}

function resolveAtmForFlyRow(row: FlyState, quotesByExpiry: QuotesByExpiry) {
  const directAtm = safeNumber(row.atm);
  if (directAtm != null && directAtm > 0) return directAtm;

  const quoteAtm = resolveAtmByExpiryOrLabel(row.expiry, row.label, quotesByExpiry);
  if (quoteAtm != null) return quoteAtm;

  return findAmtfStrike(row.nodes ?? {});
}

function buildRiskNodeXAxisCategories(
  rows: RiskReversalState[],
  nodeLabels: string[],
  xAxisMode: NodeXAxisMode
) {
  if (xAxisMode === "node") {
    return nodeLabels.map((label) => canonicalRiskLabel(label));
  }
  return resolveLatestNodeMetricFromRows(
    rows,
    nodeLabels,
    xAxisMode,
    (row, label) => resolveNodeByLabel((row as RiskReversalState).risk_reversal_nodes, label)
  );
}

function buildFlyNodeXAxisCategories(
  rows: FlyState[],
  nodeLabels: string[],
  xAxisMode: NodeXAxisMode
) {
  if (xAxisMode === "node") {
    return nodeLabels.map((label) => canonicalRiskLabel(label));
  }
  return resolveLatestNodeMetricFromRows(
    rows,
    nodeLabels,
    xAxisMode,
    (row, label) => resolveNodeByLabel((row as FlyState).nodes, label)
  );
}

const FlyMetricsPanel = memo(function FlyMetricsPanel({
  flyByExpiry,
  tenorByKey,
  rowMode,
  onRowModeChange,
  quotesByExpiry,
}: {
  flyByExpiry: FlyByExpiry;
  tenorByKey: TenorByKey;
  rowMode: RiskRowMode;
  onRowModeChange: (mode: RiskRowMode) => void;
  quotesByExpiry: QuotesByExpiry;
}) {
  const rows = useMemo(
    () => (rowMode === "tenor" ? toFlyRowsFromTenors(tenorByKey) : toFlyRows(flyByExpiry)),
    [flyByExpiry, rowMode, tenorByKey]
  );
  const flyLabels = useMemo(() => collectFlyLabels(rows), [rows]);
  const flyChartLabels = useMemo(() => orderRiskNodeChartLabels(flyLabels), [flyLabels]);
  const flyMetricLabels = useMemo(() => collectFlyMetricLabels(rows), [rows]);
  const [flyXAxisMode, setFlyXAxisMode] = useState<NodeXAxisMode>("node");
  const flyNodeChartSeries = useMemo(() => buildFlyNodeSeries(rows, flyChartLabels), [rows, flyChartLabels]);
  const flyDaysSeries = useMemo(() => buildFlyDaysSeries(rows, flyMetricLabels), [rows, flyMetricLabels]);
  const flyNodeCategoryLabels = useMemo(
    () => buildFlyNodeXAxisCategories(rows, flyChartLabels, flyXAxisMode),
    [flyChartLabels, flyXAxisMode, rows]
  );
  const flyChartTitle = useMemo(() => {
    if (flyXAxisMode === "strike") return "Fly Node Vol by Strike";
    if (flyXAxisMode === "log_moneyness") return "Fly Node Vol by Log-mny";
    return "Fly Node Vol by Node";
  }, [flyXAxisMode]);
  const flyChartXAxisLabel = flyXAxisMode === "node" ? "node" : flyXAxisMode === "strike" ? "strike" : "log-mny";
  const [flashByCell, setFlashByCell] = useState<RiskFlashByCell>({});
  const previousValuesRef = useRef<Record<string, number>>({});
  const flashNonceRef = useRef(0);

  useEffect(() => {
    const now = Date.now();
    const nextValues: Record<string, number> = {};
    const nextFlashes: RiskFlashByCell = {};

    for (const row of rows) {
      for (const label of flyLabels) {
        const node = resolveNodeByLabel(row.nodes, label);
        const value = safeNumber(node?.vol);
        if (value == null || !Number.isFinite(value)) continue;
        const cellKey = toFlyMetricCellKey("node", row.expiry, label, row.label);
        nextValues[cellKey] = value;
        const previous = previousValuesRef.current[cellKey];
        if (previous == null || previous === value) continue;
        flashNonceRef.current += 1;
        nextFlashes[cellKey] = {
          direction: value > previous ? "up" : "down",
          until: now + RISK_FLASH_DURATION_MS,
          nonce: flashNonceRef.current,
        };
      }

      for (const label of flyMetricLabels) {
        const value = resolveFlyValueByLabel(row, label);
        if (value == null || !Number.isFinite(value)) continue;
        const cellKey = toFlyMetricCellKey("fly", row.expiry, label, row.label);
        nextValues[cellKey] = value;
        const previous = previousValuesRef.current[cellKey];
        if (previous == null || previous === value) continue;
        flashNonceRef.current += 1;
        nextFlashes[cellKey] = {
          direction: value > previous ? "up" : "down",
          until: now + RISK_FLASH_DURATION_MS,
          nonce: flashNonceRef.current,
        };
      }
    }

    previousValuesRef.current = nextValues;
    const frameId = window.requestAnimationFrame(() => {
      setFlashByCell((current) => {
        const activeNow = Date.now();
        const next: RiskFlashByCell = {};
        for (const [key, flash] of Object.entries(current)) {
          if (flash.until > activeNow) {
            next[key] = flash;
          }
        }
        for (const [key, flash] of Object.entries(nextFlashes)) {
          next[key] = flash;
        }
        return next;
      });
    });
    return () => window.cancelAnimationFrame(frameId);
  }, [flyLabels, flyMetricLabels, rows]);

  useEffect(() => {
    if (Object.keys(flashByCell).length === 0) return;
    const soonestExpiry = Math.min(...Object.values(flashByCell).map((flash) => flash.until));
    const delay = Math.max(24, soonestExpiry - Date.now() + 12);
    const timeoutId = window.setTimeout(() => {
      setFlashByCell((current) => {
        const now = Date.now();
        const next: RiskFlashByCell = {};
        for (const [key, flash] of Object.entries(current)) {
          if (flash.until > now) {
            next[key] = flash;
          }
        }
        return next;
      });
    }, delay);
    return () => window.clearTimeout(timeoutId);
  }, [flashByCell]);

  useEffect(() => {
    previousValuesRef.current = {};
    const frameId = window.requestAnimationFrame(() => {
      setFlashByCell({});
    });
    return () => window.cancelAnimationFrame(frameId);
  }, [rowMode]);

  if (rows.length === 0) return null;

  return (
    <div style={{ gridColumn: "1 / -1", minWidth: 0 }}>
      <Card className="risk-grid-card">
        <div className="risk-grid__header">
          <h3 className="risk-grid__title">SVI Fly Grid</h3>
          <div className="risk-grid__header-controls">
            <div className="scale-toggle" role="group" aria-label="Fly row mode">
              <button
                type="button"
                className={`scale-toggle__button ${rowMode === "expiry" ? "is-active" : ""}`}
                onClick={() => onRowModeChange("expiry")}
              >
                Expiry
              </button>
              <button
                type="button"
                className={`scale-toggle__button ${rowMode === "tenor" ? "is-active" : ""}`}
                onClick={() => onRowModeChange("tenor")}
              >
                Tenor
              </button>
            </div>
            <div className="scale-toggle" role="group" aria-label="Fly node chart x-axis mode">
              <button
                type="button"
                className={`scale-toggle__button ${flyXAxisMode === "node" ? "is-active" : ""}`}
                onClick={() => setFlyXAxisMode("node")}
              >
                Node
              </button>
              <button
                type="button"
                className={`scale-toggle__button ${flyXAxisMode === "strike" ? "is-active" : ""}`}
                onClick={() => setFlyXAxisMode("strike")}
              >
                Strike
              </button>
              <button
                type="button"
                className={`scale-toggle__button ${flyXAxisMode === "log_moneyness" ? "is-active" : ""}`}
                onClick={() => setFlyXAxisMode("log_moneyness")}
              >
                Log-mny
              </button>
            </div>
            <div className="risk-grid__meta">{rows.length} {rowMode === "tenor" ? "tenors" : "smiles"}</div>
          </div>
        </div>
        <div className="risk-grid__scroll">
          <table className="risk-grid">
            <thead>
              <tr>
                <th className="risk-grid__stub">{rowMode === "tenor" ? "Tenor" : "Maturity"}</th>
                <th className="risk-grid__atm-head">ATM</th>
                {flyLabels.map((label) => (
                  <th key={label}>{formatFlyLabel(label)}</th>
                ))}
                {flyMetricLabels.map((label) => (
                  <th key={`fly-metric-${label}`}>{formatFlyMetricLabel(label)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={`${row.expiry}:${row.label ?? "row"}`}>
                  <th className="risk-grid__stub">
                    <span className="risk-grid__stub-main">{row.label ?? formatExpiryFromTs(row.expiry)}</span>
                  </th>
                  <td className="risk-grid__atm">{formatAtmNumber(resolveAtmForFlyRow(row, quotesByExpiry))}</td>
                  {flyLabels.map((label) => {
                    const node = resolveNodeByLabel(row.nodes, label);
                    const value = safeNumber(node?.vol);
                    const flashState = flashByCell[toFlyMetricCellKey("node", row.expiry, label, row.label)];
                    const flashClass = flashState
                      ? `risk-grid__cell--${flashState.direction} risk-grid__flash-token-${flashState.nonce % 2 === 0 ? "a" : "b"}`
                      : "";
                    const strikeText = formatRiskStrike(node?.strike);
                    const logMoneynessText = formatRiskLogMoneyness(node?.log_moneyness);
                    const title = node
                      ? `${label} | vol ${formatRiskVol(node.vol)} | ${strikeText} | ${logMoneynessText} | delta ${node.delta?.toFixed(4) ?? "--"}`
                      : `${label} | no data`;
                    const secondaryText =
                      flyXAxisMode === "strike"
                        ? strikeText
                        : flyXAxisMode === "log_moneyness"
                          ? logMoneynessText
                          : null;
                    return (
                      <td key={label} className={`risk-grid__cell ${flashClass}`.trim()} title={title}>
                        <div className="risk-grid__cell-main">{formatRiskVol(value)}</div>
                        {secondaryText ? <div className="risk-grid__cell-sub">{secondaryText}</div> : null}
                      </td>
                    );
                  })}
                  {flyMetricLabels.map((label) => {
                    const value = resolveFlyValueByLabel(row, label);
                    const flashState = flashByCell[toFlyMetricCellKey("fly", row.expiry, label, row.label)];
                    const flashClass = flashState
                      ? `risk-grid__rr--${flashState.direction} risk-grid__flash-token-${flashState.nonce % 2 === 0 ? "a" : "b"}`
                      : "";
                    return (
                      <td key={`fly-value-${label}`} className={`risk-grid__rr ${flashClass}`.trim()}>
                        {formatFlyMetricValue(value)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          {flyLabels.length === 0 && flyMetricLabels.length === 0 ? (
            <div className="risk-grid__empty">No fly nodes yet</div>
          ) : null}
        </div>

        {flyNodeChartSeries.length > 0 && flyNodeCategoryLabels.length > 0 ? (
          <div className="risk-category-charts">
            <RiskCategoryChart
              title={flyChartTitle}
              xLabel={flyChartXAxisLabel}
              yLabel="vol"
              categories={flyNodeCategoryLabels}
              series={flyNodeChartSeries}
              yTickFormatter={(value) => formatRiskAxisTick(value, true)}
              doubleHeight
            />
            {flyDaysSeries.length > 0 ? (
              <RrDaysChart
                title="Fly by Days"
                xLabel="days"
                yLabel="fly"
                series={flyDaysSeries}
                doubleHeight
              />
            ) : null}
          </div>
        ) : null}
      </Card>
    </div>
  );
});

const RiskReversalNodesPanel = memo(function RiskReversalNodesPanel({
  riskReversalByExpiry,
  tenorByKey,
  rowMode,
  onRowModeChange,
  quotesByExpiry,
}: {
  riskReversalByExpiry: RiskReversalByExpiry;
  tenorByKey: TenorByKey;
  rowMode: RiskRowMode;
  onRowModeChange: (mode: RiskRowMode) => void;
  quotesByExpiry: QuotesByExpiry;
}) {
  const rows = useMemo(
    () =>
      rowMode === "tenor"
        ? toRiskReversalRowsFromTenors(tenorByKey)
        : toRiskReversalRows(riskReversalByExpiry),
    [riskReversalByExpiry, rowMode, tenorByKey]
  );
  const nodeLabels = useMemo(() => collectRiskNodeLabels(rows), [rows]);
  const nodeChartLabels = useMemo(() => orderRiskNodeChartLabels(nodeLabels), [nodeLabels]);
  const rrLabels = useMemo(() => collectRiskReversalLabels(rows), [rows]);
  const [flashByCell, setFlashByCell] = useState<RiskFlashByCell>({});
  const [nodeXAxisMode, setNodeXAxisMode] = useState<NodeXAxisMode>("node");
  const [focusedRiskSeriesId, setFocusedRiskSeriesId] = useState<string | null>(null);
  const previousValuesRef = useRef<Record<string, number>>({});
  const flashNonceRef = useRef(0);
  const nodeChartSeries = useMemo(
    () => buildRiskCategorySeries(rows, nodeChartLabels, "node"),
    [rows, nodeChartLabels]
  );
  const rrDaysSeries = useMemo(() => buildRrDaysSeries(rows, rrLabels), [rows, rrLabels]);
  const nodeCategoryLabels = useMemo(
    () => buildRiskNodeXAxisCategories(rows, nodeChartLabels, nodeXAxisMode),
    [nodeChartLabels, nodeXAxisMode, rows]
  );
  const nodeChartTitle = useMemo(() => {
    if (nodeXAxisMode === "strike") return "Node Vol by Strike";
    if (nodeXAxisMode === "log_moneyness") return "Node Vol by Log-mny";
    return "Node Vol by Node";
  }, [nodeXAxisMode]);
  const nodeChartXAxisLabel =
    nodeXAxisMode === "node" ? "node" : nodeXAxisMode === "strike" ? "strike" : "log-mny";
  const activeSeriesIds = useMemo(() => {
    const ids = new Set<string>();
    for (const entry of nodeChartSeries) ids.add(entry.id);
    return ids;
  }, [nodeChartSeries]);
  const handleRiskSeriesFocusToggle = useCallback((seriesId: string) => {
    setFocusedRiskSeriesId((current) => (current === seriesId ? null : seriesId));
  }, []);

  useEffect(() => {
    const now = Date.now();
    const nextValues: Record<string, number> = {};
    const nextFlashes: RiskFlashByCell = {};

    for (const row of rows) {
      for (const [label, node] of Object.entries(row.risk_reversal_nodes ?? {})) {
        const vol = safeNumber(node.vol);
        if (vol == null || !Number.isFinite(vol)) continue;
        const cellKey = toRiskMetricCellKey("node", row.expiry, label, row.label);
        nextValues[cellKey] = vol;
        const previous = previousValuesRef.current[cellKey];
        if (previous == null || previous === vol) continue;
        flashNonceRef.current += 1;
        nextFlashes[cellKey] = {
          direction: vol > previous ? "up" : "down",
          until: now + RISK_FLASH_DURATION_MS,
          nonce: flashNonceRef.current,
        };
      }

      for (const [label, rawValue] of Object.entries(row.risk_reversals ?? {})) {
        const value = safeNumber(rawValue);
        if (value == null || !Number.isFinite(value)) continue;
        const cellKey = toRiskMetricCellKey("rr", row.expiry, label, row.label);
        nextValues[cellKey] = value;
        const previous = previousValuesRef.current[cellKey];
        if (previous == null || previous === value) continue;
        flashNonceRef.current += 1;
        nextFlashes[cellKey] = {
          direction: value > previous ? "up" : "down",
          until: now + RISK_FLASH_DURATION_MS,
          nonce: flashNonceRef.current,
        };
      }
    }

    previousValuesRef.current = nextValues;

    const frameId = window.requestAnimationFrame(() => {
      setFlashByCell((current) => {
        const activeNow = Date.now();
        const next: RiskFlashByCell = {};
        for (const [key, flash] of Object.entries(current)) {
          if (flash.until > activeNow) {
            next[key] = flash;
          }
        }
        for (const [key, flash] of Object.entries(nextFlashes)) {
          next[key] = flash;
        }
        return next;
      });
    });
    return () => window.cancelAnimationFrame(frameId);
  }, [rows]);

  useEffect(() => {
    if (Object.keys(flashByCell).length === 0) return;
    const soonestExpiry = Math.min(...Object.values(flashByCell).map((flash) => flash.until));
    const delay = Math.max(24, soonestExpiry - Date.now() + 12);
    const timeoutId = window.setTimeout(() => {
      setFlashByCell((current) => {
        const now = Date.now();
        const next: RiskFlashByCell = {};
        for (const [key, flash] of Object.entries(current)) {
          if (flash.until > now) {
            next[key] = flash;
          }
        }
        return next;
      });
    }, delay);
    return () => window.clearTimeout(timeoutId);
  }, [flashByCell]);

  useEffect(() => {
    if (focusedRiskSeriesId == null) return;
    if (activeSeriesIds.has(focusedRiskSeriesId)) return;
    const frameId = window.requestAnimationFrame(() => {
      setFocusedRiskSeriesId(null);
    });
    return () => window.cancelAnimationFrame(frameId);
  }, [activeSeriesIds, focusedRiskSeriesId]);

  useEffect(() => {
    previousValuesRef.current = {};
    const frameId = window.requestAnimationFrame(() => {
      setFlashByCell({});
      setFocusedRiskSeriesId(null);
    });
    return () => window.cancelAnimationFrame(frameId);
  }, [rowMode]);

  if (rows.length === 0 || (nodeLabels.length === 0 && rrLabels.length === 0)) return null;

  return (
    <div style={{ gridColumn: "1 / -1", minWidth: 0 }}>
      <Card className="risk-grid-card">
        <div className="risk-grid__header">
          <h3 className="risk-grid__title">Risk Reversal Nodes</h3>
          <div className="risk-grid__header-controls">
            <div className="scale-toggle" role="group" aria-label="Risk row mode">
              <button
                type="button"
                className={`scale-toggle__button ${rowMode === "expiry" ? "is-active" : ""}`}
                onClick={() => onRowModeChange("expiry")}
              >
                Expiry
              </button>
              <button
                type="button"
                className={`scale-toggle__button ${rowMode === "tenor" ? "is-active" : ""}`}
                onClick={() => onRowModeChange("tenor")}
              >
                Tenor
              </button>
            </div>
            <div className="scale-toggle" role="group" aria-label="Risk node chart x-axis mode">
              <button
                type="button"
                className={`scale-toggle__button ${nodeXAxisMode === "node" ? "is-active" : ""}`}
                onClick={() => setNodeXAxisMode("node")}
              >
                Node
              </button>
              <button
                type="button"
                className={`scale-toggle__button ${nodeXAxisMode === "strike" ? "is-active" : ""}`}
                onClick={() => setNodeXAxisMode("strike")}
              >
                Strike
              </button>
              <button
                type="button"
                className={`scale-toggle__button ${nodeXAxisMode === "log_moneyness" ? "is-active" : ""}`}
                onClick={() => setNodeXAxisMode("log_moneyness")}
              >
                Log-mny
              </button>
            </div>
            <div className="risk-grid__meta">{rows.length} {rowMode === "tenor" ? "tenors" : "smiles"}</div>
          </div>
        </div>
        <div className="risk-grid__scroll">
          <table className="risk-grid">
            <thead>
              <tr>
                <th className="risk-grid__stub">{rowMode === "tenor" ? "Tenor" : "Maturity"}</th>
                <th className="risk-grid__atm-head">ATM</th>
                {nodeLabels.map((label) => (
                  <th key={label}>{label}</th>
                ))}
                {rrLabels.map((label) => (
                  <th key={`rr-head-${label}`}>{formatRiskReversalLabel(label)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row: RiskReversalState) => (
                <tr key={`${row.expiry}:${row.label ?? "row"}`}>
                  <th className="risk-grid__stub">
                    <span className="risk-grid__stub-main">{row.label ?? formatExpiryFromTs(row.expiry)}</span>
                  </th>
                  <td className="risk-grid__atm">{formatAtmNumber(resolveAtmForRiskRow(row, quotesByExpiry))}</td>
                  {nodeLabels.map((label) => {
                    const node = resolveNodeByLabel(row.risk_reversal_nodes, label);
                    const flashState = flashByCell[toRiskMetricCellKey("node", row.expiry, label, row.label)];
                    const flashClass = flashState
                      ? `risk-grid__cell--${flashState.direction} risk-grid__flash-token-${flashState.nonce % 2 === 0 ? "a" : "b"}`
                      : "";
                    const strikeText = formatRiskStrike(node?.strike);
                    const logMoneynessText = formatRiskLogMoneyness(node?.log_moneyness);
                    const title = node
                      ? `${label} | vol ${formatRiskVol(node.vol)} | ${strikeText} | ${logMoneynessText} | delta ${node.delta?.toFixed(4) ?? "--"}`
                      : `${label} | no data`;
                    const secondaryText =
                      nodeXAxisMode === "strike"
                        ? strikeText
                        : nodeXAxisMode === "log_moneyness"
                          ? logMoneynessText
                          : null;
                    return (
                      <td key={label} className={`risk-grid__cell ${flashClass}`.trim()} title={title}>
                        <div className="risk-grid__cell-main">{formatRiskVol(node?.vol)}</div>
                        {secondaryText ? <div className="risk-grid__cell-sub">{secondaryText}</div> : null}
                      </td>
                    );
                  })}
                  {rrLabels.map((label) => {
                    const value = safeNumber(row.risk_reversals?.[label]);
                    const flashState = flashByCell[toRiskMetricCellKey("rr", row.expiry, label, row.label)];
                    const flashClass = flashState
                      ? `risk-grid__rr--${flashState.direction} risk-grid__flash-token-${flashState.nonce % 2 === 0 ? "a" : "b"}`
                      : "";
                    return (
                      <td key={`rr-${label}`} className={`risk-grid__rr ${flashClass}`.trim()}>
                        {formatRiskReversalValue(value)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="risk-category-charts">
          {nodeLabels.length > 0 ? (
            <RiskCategoryChart
              title={nodeChartTitle}
              xLabel={nodeChartXAxisLabel}
              yLabel="vol"
              categories={nodeCategoryLabels}
              series={nodeChartSeries}
              yTickFormatter={(value) => formatRiskAxisTick(value, true)}
              focusedSeriesId={focusedRiskSeriesId}
              onSeriesFocusToggle={handleRiskSeriesFocusToggle}
              doubleHeight
            />
          ) : null}
          {rrLabels.length > 0 ? (
            <RrDaysChart
              title="RR by Days"
              xLabel="days"
              yLabel="rr"
              series={rrDaysSeries}
              doubleHeight
            />
          ) : null}
        </div>
      </Card>
    </div>
  );
});

function formatExpiryFromTs(expiry: number) {
  try {
    return new Date(expiry).toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "2-digit",
    }).replace(/\s/g, "");
  } catch {
    return String(expiry);
  }
}

const ThroughMatrixPanel = memo(function ThroughMatrixPanel({
  matrix,
}: {
  matrix: ReturnType<typeof buildSmileThroughMatrix>;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const wrapWidth = useContainerWidth(wrapRef);
  if (matrix.rows.length === 0 || matrix.strikes.length === 0) return null;

  const stubWidth = 92;
  const strikeCount = matrix.strikes.length;
  const targetCellSize = Math.floor((Math.max(240, wrapWidth - stubWidth - 20) || 240) / strikeCount);
  const cellSize = Math.min(12, Math.max(7, Number.isFinite(targetCellSize) ? targetCellSize : 10));
  const labelStep = Math.max(1, Math.ceil(70 / Math.max(cellSize, 1)));
  const maxThrough = matrix.maxThrough > 0 ? matrix.maxThrough : 1;
  const tableWidthPx = Math.max(0, stubWidth + strikeCount * cellSize + strikeCount + 2);
  const matrixVars = {
    "--through-stub-size": `${stubWidth}px`,
    "--through-cell-size": `${cellSize.toFixed(2)}px`,
    "--through-colhead-size": `${cellSize.toFixed(2)}px`,
    "--through-table-size": `${tableWidthPx.toFixed(2)}px`,
  } as CSSProperties;

  return (
    <div ref={wrapRef} style={{ gridColumn: "1 / -1", minWidth: 0 }}>
      <Card className="through-matrix-card" style={matrixVars}>
        <div className="through-matrix__header">
          <h3 className="through-matrix__title">SVI Through Matrix</h3>
          <div className="through-matrix__legend">
            <span className="through-matrix__legend-item through-matrix__legend-item--bid">Bid &gt; SVI mid</span>
            <span className="through-matrix__legend-item through-matrix__legend-item--ask">Ask &lt; SVI mid</span>
            <span className="through-matrix__legend-item through-matrix__legend-item--okx">OKX also through</span>
            <span className="through-matrix__legend-item through-matrix__legend-item--neutral">Neutral</span>
          </div>
        </div>

        <div className="through-matrix__scroll">
          <table className="through-matrix">
            <thead>
              <tr>
                <th className="through-matrix__stub through-matrix__stub--head">Maturity</th>
                {matrix.strikes.map((strike, idx) => (
                  <th key={strike} className="through-matrix__colhead">
                    {idx % labelStep === 0 ? (
                      <span className="through-matrix__colhead-label">{formatStrike(strike)}</span>
                    ) : null}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {matrix.rows.map((row) => (
                <tr key={row.expiry}>
                  <th className="through-matrix__stub">{row.label}</th>
                  {matrix.strikes.map((strike) => {
                    const key = String(strike);
                    const cell = row.cellsByStrike[key];
                    const side = cell?.side ?? "neutral";
                    const okxAlsoThrough = Boolean(cell && (cell.okxBidThrough || cell.okxAskThrough));
                    const intensity = cell ? Math.min(1, cell.throughValue / maxThrough) : 0;
                    const fillColor =
                      side === "bid"
                        ? `rgba(76, 184, 112, ${0.2 + intensity * 0.58})`
                        : side === "ask"
                          ? `rgba(231, 113, 80, ${0.2 + intensity * 0.58})`
                          : "rgba(100, 114, 133, 0.28)";

                    const title = cell
                      ? `${row.label} | K ${formatStrike(strike)} | SVI ${cell.sviIv?.toFixed(2) ?? "--"} | D-BID ${cell.bestBidIvDeribit?.toFixed(2) ?? "--"} (${cell.bidThroughDeribit.toFixed(2)}) | D-ASK ${cell.bestAskIvDeribit?.toFixed(2) ?? "--"} (${cell.askThroughDeribit.toFixed(2)}) | O-BID ${cell.bestBidIvOkx?.toFixed(2) ?? "--"} (${cell.bidThroughOkx.toFixed(2)}) | O-ASK ${cell.bestAskIvOkx?.toFixed(2) ?? "--"} (${cell.askThroughOkx.toFixed(2)})`
                      : `${row.label} | K ${formatStrike(strike)} | no quote`;

                    return (
                      <td
                        key={key}
                        className={`through-matrix__cell through-matrix__cell--${side}${okxAlsoThrough ? " through-matrix__cell--okx" : ""}`}
                        style={{ backgroundColor: fillColor }}
                        title={title}
                      />
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
});

export default function App() {
  const outerRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const outerWidth = useContainerWidth(outerRef);
  const viewportHeight = useViewportHeight();
  const columnCount = getColumnCount(outerWidth);
  const isPhoneLayout = outerWidth > 0 && outerWidth <= 720;

  const chartHeight = isPhoneLayout ? 250 : columnCount >= 3 ? 320 : columnCount === 2 ? 340 : 360;
  const canSplitOverviewPanels = outerWidth >= 900;
  const overviewCompactVarianceHeight = isPhoneLayout ? 280 : canSplitOverviewPanels ? 380 : columnCount >= 3 ? 350 : 370;
  const overviewCompactSurfaceHeight = isPhoneLayout ? 320 : canSplitOverviewPanels ? 380 : columnCount >= 3 ? 380 : 400;
  const overviewExpandedVarianceHeight = isPhoneLayout ? 300 : columnCount >= 3 ? 460 : 440;
  const overviewExpandedSurfaceHeight = isPhoneLayout ? 340 : columnCount >= 3 ? 540 : 500;

  const [activeDashboardTab, setActiveDashboardTab] = useState<DashboardTabKey>("market");
  const [hoverX, setHoverX] = useState<number | null>(null);
  const [expandedExpiry, setExpandedExpiry] = useState<number | null>(null);
  const [expandedFitPanel, setExpandedFitPanel] = useState<FitOverviewPanelKey | null>(null);
  const [varianceScaleMode, setVarianceScaleMode] = useState<"auto" | "focus" | "tight">("focus");
  const [gTestScaleMode, setGTestScaleMode] = useState<"auto" | "focus" | "tight">("focus");
  const [surface3DMode, setSurface3DMode] = useState<"vol" | "var">("vol");
  const [smileXAxisMode, setSmileXAxisMode] = useState<SmileXAxisMode>("log_moneyness");
  const [riskRowMode, setRiskRowMode] = useState<RiskRowMode>("expiry");
  const [exchangeVisibility, setExchangeVisibility] = useState<ExchangeVisibility>({
    deribit: true,
    okx: true,
  });
  const [tradeAlert, setTradeAlert] = useState<{ id: number; message: string } | null>(null);
  const [tradeAlertVisible, setTradeAlertVisible] = useState(false);
  const [showDisclaimer, setShowDisclaimer] = useState(() => {
    if (typeof window === "undefined") return false;
    try {
      return window.localStorage.getItem(DISCLAIMER_ACK_KEY) !== "1";
    } catch {
      return true;
    }
  });
  const lastTradeAlertKeyRef = useRef<string>("");
  const acknowledgeDisclaimer = useCallback(() => {
    setShowDisclaimer(false);
    try {
      window.localStorage.setItem(DISCLAIMER_ACK_KEY, "1");
    } catch {
      // no-op: if storage is unavailable we still allow session usage
    }
  }, []);
  const {
    connected,
    currentFitError,
    flyByExpiry,
    lastFitError,
    lastFitElapsedSeconds,
    lastSnapshotUpdated,
    quotesByExpiry,
    reconnectAttempt,
    riskReversalByExpiry,
    tenorByKey,
    snapshot,
  } = useSviFeed();
  const deferredQuotesByExpiry = useDeferredValue(quotesByExpiry);
  const deferredFlyByExpiry = useDeferredValue(flyByExpiry);
  const deferredTenorByKey = useDeferredValue(tenorByKey);

  const varianceSeries = useMemo(() => buildVarianceSeries(snapshot), [snapshot]);
  const gTestSeries = useMemo(() => buildGTestSeries(snapshot), [snapshot]);
  const surfaceGrid = useMemo(() => buildSurfaceGrid(snapshot), [snapshot]);
  const gTestUnit = useMemo(
    () =>
      snapshot?.smiles.find((smile) => typeof smile.g_test_unit === "string")?.g_test_unit ??
      surfaceGrid?.rows.find((row) => typeof row.g_test_unit === "string")?.g_test_unit ??
      null,
    [snapshot, surfaceGrid]
  );
  const varianceAutoXDomain = useMemo(() => buildVarianceXDomain(snapshot), [snapshot]);
  const varianceXDomain = useMemo<[number, number]>(() => {
    if (varianceScaleMode === "focus") return [-2, 2];
    if (varianceScaleMode === "tight") return [-1, 1];
    return varianceAutoXDomain;
  }, [varianceAutoXDomain, varianceScaleMode]);
  const gTestXDomain = useMemo<[number, number]>(() => {
    if (gTestScaleMode === "focus") return [-2, 2];
    if (gTestScaleMode === "tight") return [-1, 1];
    return varianceAutoXDomain;
  }, [gTestScaleMode, varianceAutoXDomain]);
  const varianceWindowedSeries = useMemo(
    () =>
      varianceSeries.map((item) => ({
        ...item,
        data: item.data.map((point) =>
          point.x >= varianceXDomain[0] && point.x <= varianceXDomain[1]
            ? point
            : { ...point, y: null }
        ),
      })),
    [varianceSeries, varianceXDomain]
  );
  const gTestWindowedSeries = useMemo(
    () =>
      gTestSeries.map((item) => ({
        ...item,
        data: item.data.map((point) =>
          point.x >= gTestXDomain[0] && point.x <= gTestXDomain[1]
            ? point
            : { ...point, y: null }
        ),
      })),
    [gTestSeries, gTestXDomain]
  );
  const varianceRawYDomain = useMemo(
    () => buildVarianceYDomain(varianceWindowedSeries),
    [varianceWindowedSeries]
  );
  const gTestRawYDomain = useMemo(
    () => buildGTestYDomain(gTestWindowedSeries),
    [gTestWindowedSeries]
  );
  const [varianceYDomain, setVarianceYDomain] = useState<[number, number]>(varianceRawYDomain);
  const [gTestYDomain, setGTestYDomain] = useState<[number, number]>(gTestRawYDomain);
  useEffect(() => {
    const frameId = window.requestAnimationFrame(() => {
      setVarianceYDomain((current) => smoothVarianceDomain(current, varianceRawYDomain));
    });
    return () => window.cancelAnimationFrame(frameId);
  }, [varianceRawYDomain]);
  useEffect(() => {
    const frameId = window.requestAnimationFrame(() => {
      setGTestYDomain((current) => smoothVarianceDomain(current, gTestRawYDomain));
    });
    return () => window.cancelAnimationFrame(frameId);
  }, [gTestRawYDomain]);
  const varianceXTicks = useMemo(() => {
    const step = chooseTickStep(varianceXDomain[1] - varianceXDomain[0], [0.05, 0.1, 0.2, 0.25, 0.5, 1], 7);
    return buildTicks(varianceXDomain[0], varianceXDomain[1], step);
  }, [varianceXDomain]);
  const gTestXTicks = useMemo(() => {
    const step = chooseTickStep(gTestXDomain[1] - gTestXDomain[0], [0.05, 0.1, 0.2, 0.25, 0.5, 1], 7);
    return buildTicks(gTestXDomain[0], gTestXDomain[1], step);
  }, [gTestXDomain]);
  const varianceYTicks = useMemo(() => {
    const step = chooseTickStep(
      varianceYDomain[1] - varianceYDomain[0],
      [0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.25, 0.5],
      6
    );
    return buildTicks(varianceYDomain[0], varianceYDomain[1], step);
  }, [varianceYDomain]);
  const gTestYTicks = useMemo(() => {
    const step = chooseTickStep(
      gTestYDomain[1] - gTestYDomain[0],
      [1, 2, 5, 10, 20, 25, 50, 100],
      6
    );
    return buildTicks(gTestYDomain[0], gTestYDomain[1], step);
  }, [gTestYDomain]);

  const smileChartRows = useMemo(() => buildSmileChartRows(snapshot, quotesByExpiry), [quotesByExpiry, snapshot]);
  const smileDisplayRows = useMemo(
    () =>
      smileChartRows.map((row) =>
        projectSmileRowXAxis(applyExchangeVisibility(row, exchangeVisibility), smileXAxisMode)
      ),
    [exchangeVisibility, smileChartRows, smileXAxisMode]
  );
  const exchangeVisibilityKey = `${exchangeVisibility.deribit ? "d1" : "d0"}${exchangeVisibility.okx ? "o1" : "o0"}`;
  const throughMatrix = useMemo(
    () => buildSmileThroughMatrix(snapshot, deferredQuotesByExpiry),
    [snapshot, deferredQuotesByExpiry]
  );
  const expandedRow = useMemo(
    () => smileDisplayRows.find((row) => row.expiry === expandedExpiry) ?? null,
    [expandedExpiry, smileDisplayRows]
  );
  const queuedRows = useMemo(
    () => smileDisplayRows.filter((row) => row.expiry !== expandedExpiry),
    [expandedExpiry, smileDisplayRows]
  );

  useEffect(() => {
    if (expandedExpiry == null) return;
    if (smileDisplayRows.some((row) => row.expiry === expandedExpiry)) return;
    const frameId = window.requestAnimationFrame(() => {
      setExpandedExpiry(null);
    });
    return () => window.cancelAnimationFrame(frameId);
  }, [expandedExpiry, smileDisplayRows]);

  useEffect(() => {
    if (canSplitOverviewPanels || expandedFitPanel == null) return;
    const frameId = window.requestAnimationFrame(() => {
      setExpandedFitPanel(null);
    });
    return () => window.cancelAnimationFrame(frameId);
  }, [canSplitOverviewPanels, expandedFitPanel]);

  useEffect(() => {
    let latestTradeEvent:
      | {
          updateTs: number;
          expiry: number;
          label: string;
          strike: number;
          iv: number;
        }
      | null = null;

    for (const row of smileChartRows) {
      for (const point of row.lastTradeScatter) {
        if (point.tradeUpdateTs == null || point.flashUntilTs == null) continue;
        if (!latestTradeEvent || point.tradeUpdateTs > latestTradeEvent.updateTs) {
          latestTradeEvent = {
            updateTs: point.tradeUpdateTs,
            expiry: row.expiry,
            label: row.label,
            strike: point.strike,
            iv: point.y,
          };
        }
      }
    }

    if (!latestTradeEvent) return;

    const eventKey = `${latestTradeEvent.updateTs}:${latestTradeEvent.expiry}:${latestTradeEvent.strike}:${latestTradeEvent.iv.toFixed(4)}`;
    if (eventKey === lastTradeAlertKeyRef.current) return;
    lastTradeAlertKeyRef.current = eventKey;

    const nextAlert = {
      id: latestTradeEvent.updateTs,
      message: `Last Trade IV ${latestTradeEvent.label} K ${formatStrike(latestTradeEvent.strike)} ${latestTradeEvent.iv.toFixed(2)}%`,
    };
    let enterRaf: number | null = null;
    const showRaf = window.requestAnimationFrame(() => {
      setTradeAlert(nextAlert);
      setTradeAlertVisible(false);
      enterRaf = window.requestAnimationFrame(() => {
        setTradeAlertVisible(true);
      });
    });
    const fadeTimeout = window.setTimeout(() => {
      setTradeAlertVisible(false);
    }, 2200);
    const clearTimeout = window.setTimeout(() => {
      setTradeAlert((current) => (current?.id === nextAlert.id ? null : current));
    }, 2900);

    return () => {
      window.cancelAnimationFrame(showRaf);
      if (enterRaf != null) window.cancelAnimationFrame(enterRaf);
      window.clearTimeout(fadeTimeout);
      window.clearTimeout(clearTimeout);
    };
  }, [smileChartRows]);

  const rowHeight = chartHeight + (isPhoneLayout ? 72 : 88);
  const rowCount = Math.ceil(smileDisplayRows.length / columnCount);
  const [startRow, endRow] = useVirtualGrid({
    itemCount: rowCount,
    itemHeight: rowHeight,
    containerRef: scrollRef,
    overscan: 1,
  });

  const start = startRow * columnCount;
  const end = endRow * columnCount;
  const visibleRows = smileDisplayRows.slice(start, end);
  const visibleSmileChartCount = expandedRow ? 1 : visibleRows.length;
  const mountedSmileChartCount = expandedRow ? queuedRows.length + 1 : visibleRows.length;
  const topSpacer = startRow * rowHeight;
  const bottomSpacer = Math.max(0, (rowCount - endRow) * rowHeight);
  const focusChartHeight = isPhoneLayout
    ? Math.max(280, viewportHeight - 260)
    : Math.max(420, viewportHeight - 340);
  const varianceExpanded = expandedFitPanel === "variance";
  const surface3DExpanded = expandedFitPanel === "surface3d";
  const gTestExpanded = expandedFitPanel === "g_test";
  const showVariancePanel = expandedFitPanel == null || varianceExpanded;
  const showSurface3DPanel = expandedFitPanel == null || surface3DExpanded;
  const showGTestPanel = expandedFitPanel == null || gTestExpanded;
  const varianceHeight = varianceExpanded ? overviewExpandedVarianceHeight : overviewCompactVarianceHeight;
  const surface3DHeight = surface3DExpanded ? overviewExpandedSurfaceHeight : overviewCompactSurfaceHeight;
  const gTestHeight = gTestExpanded ? overviewExpandedVarianceHeight : overviewCompactVarianceHeight;

  return (
    <div className="app-shell">
      {showDisclaimer ? <FirstVisitDisclaimer onAcknowledge={acknowledgeDisclaimer} /> : null}
      <DashboardHeader
        connected={connected}
        currentFitError={currentFitError}
        lastFitError={lastFitError}
        lastFitElapsedSeconds={lastFitElapsedSeconds}
        lastSnapshotUpdated={lastSnapshotUpdated}
        reconnectAttempt={reconnectAttempt}
        snapshotCcy={snapshot?.ccy ?? "—"}
        snapshotKind={snapshot?.x_axis?.kind ?? "x"}
        smileCount={snapshot?.smiles.length ?? 0}
        tradeAlert={tradeAlert}
        tradeAlertVisible={tradeAlertVisible}
      />

      <div ref={outerRef} className="app-layout">
        <div className="app-layout__inner">
          <div className="workspace-tabs" role="tablist" aria-label="Dashboard views">
            <button
              type="button"
              role="tab"
              aria-selected={activeDashboardTab === "market"}
              className={`workspace-tabs__button ${activeDashboardTab === "market" ? "is-active" : ""}`.trim()}
              onClick={() => setActiveDashboardTab("market")}
            >
              Market
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeDashboardTab === "fit"}
              className={`workspace-tabs__button ${activeDashboardTab === "fit" ? "is-active" : ""}`.trim()}
              onClick={() => setActiveDashboardTab("fit")}
            >
              Fit
            </button>
          </div>

          {activeDashboardTab === "market" ? (
            <>
              <RiskReversalNodesPanel
                riskReversalByExpiry={riskReversalByExpiry}
                tenorByKey={deferredTenorByKey}
                rowMode={riskRowMode}
                onRowModeChange={setRiskRowMode}
                quotesByExpiry={quotesByExpiry}
              />

              <FlyMetricsPanel
                flyByExpiry={deferredFlyByExpiry}
                tenorByKey={deferredTenorByKey}
                rowMode={riskRowMode}
                onRowModeChange={setRiskRowMode}
                quotesByExpiry={deferredQuotesByExpiry}
              />

              <ThroughMatrixPanel matrix={throughMatrix} />

              <div className="smile-section__header">
                <h2 className="smile-section__title">Smile Matrix</h2>
                <div className="smile-section__controls">
                  <div className="scale-toggle" role="group" aria-label="Smile x-axis mode">
                    <button
                      type="button"
                      className={`scale-toggle__button ${smileXAxisMode === "log_moneyness" ? "is-active" : ""}`}
                      onClick={() => setSmileXAxisMode("log_moneyness")}
                    >
                      Log-mny
                    </button>
                    <button
                      type="button"
                      className={`scale-toggle__button ${smileXAxisMode === "strike" ? "is-active" : ""}`}
                      onClick={() => setSmileXAxisMode("strike")}
                    >
                      Strike
                    </button>
                  </div>
                  <div className="scale-toggle" role="group" aria-label="Smile exchange visibility">
                    <button
                      type="button"
                      className={`scale-toggle__button ${exchangeVisibility.deribit ? "is-active" : ""}`}
                      onClick={() =>
                        setExchangeVisibility((previous) => ({
                          ...previous,
                          deribit: !previous.deribit,
                        }))
                      }
                    >
                      Deribit
                    </button>
                    <button
                      type="button"
                      className={`scale-toggle__button ${exchangeVisibility.okx ? "is-active" : ""}`}
                      onClick={() =>
                        setExchangeVisibility((previous) => ({
                          ...previous,
                          okx: !previous.okx,
                        }))
                      }
                    >
                      OKX
                    </button>
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div
              className={`overview-panels${canSplitOverviewPanels ? " overview-panels--split" : ""}${expandedFitPanel ? " overview-panels--spotlight" : ""}`.trim()}
            >
              {showGTestPanel ? (
                <GTestPanel
                  hoverX={hoverX}
                  onHoverX={setHoverX}
                  scaleMode={gTestScaleMode}
                  onScaleModeChange={setGTestScaleMode}
                  series={gTestSeries}
                  snapshotKind={snapshot?.x_axis?.kind ?? "x"}
                  snapshotCcy={snapshot?.ccy ?? "—"}
                  smileCount={snapshot?.smiles.length ?? 0}
                  unit={gTestUnit}
                  height={gTestHeight}
                  xDomain={gTestXDomain}
                  xTicks={gTestXTicks}
                  yDomain={gTestYDomain}
                  yTicks={gTestYTicks}
                  expanded={gTestExpanded}
                  onExpand={canSplitOverviewPanels ? () => setExpandedFitPanel("g_test") : undefined}
                  onCollapse={gTestExpanded ? () => setExpandedFitPanel(null) : undefined}
                />
              ) : null}

              {showVariancePanel ? (
                <VariancePanel
                  hoverX={hoverX}
                  onHoverX={setHoverX}
                  scaleMode={varianceScaleMode}
                  onScaleModeChange={setVarianceScaleMode}
                  series={varianceSeries}
                  snapshotKind={snapshot?.x_axis?.kind ?? "x"}
                  snapshotCcy={snapshot?.ccy ?? "—"}
                  smileCount={snapshot?.smiles.length ?? 0}
                  varHeight={varianceHeight}
                  xDomain={varianceXDomain}
                  xTicks={varianceXTicks}
                  yDomain={varianceYDomain}
                  yTicks={varianceYTicks}
                  expanded={varianceExpanded}
                  onExpand={canSplitOverviewPanels ? () => setExpandedFitPanel("variance") : undefined}
                  onCollapse={varianceExpanded ? () => setExpandedFitPanel(null) : undefined}
                />
              ) : null}

              {showSurface3DPanel ? (
                <Surface3DPanel
                  grid={surfaceGrid}
                  mode={surface3DMode}
                  onModeChange={setSurface3DMode}
                  height={surface3DHeight}
                  smileCount={snapshot?.smiles.length ?? 0}
                  snapshotTs={snapshot?.ts}
                  expanded={surface3DExpanded}
                  onExpand={canSplitOverviewPanels ? () => setExpandedFitPanel("surface3d") : undefined}
                  onCollapse={surface3DExpanded ? () => setExpandedFitPanel(null) : undefined}
                />
              ) : null}
            </div>
          )}

          {activeDashboardTab === "market" ? (
            <>
              {smileDisplayRows.length === 0 ? (
                <Card>
                  <div className="empty-state">No volatility smile data yet.</div>
                </Card>
              ) : expandedRow ? (
                <div className="smile-focus-layout">
                  <aside className="smile-queue">
                    <div className="smile-queue__header">Queue</div>
                    <div className="smile-queue__list">
                      {queuedRows.map((row) => (
                        <button
                          key={row.expiry}
                          type="button"
                          className="smile-queue__item"
                          onClick={() => setExpandedExpiry(row.expiry)}
                        >
                          <MiniSmileCanvasChart row={row} lineColor={FITTED_CURVE_COLOR} />
                          <div className="smile-queue__title-row">
                            <div className="smile-queue__title">{row.label}</div>
                            <SmileExchangeBadges hasDeribit={row.hasDeribit} hasOkx={row.hasOkx} />
                          </div>
                          <SmileAtmBadge atm={row.atm} className="smile-atm--queue" />
                        </button>
                      ))}
                    </div>
                  </aside>

                  <div className="smile-focus-main">
                    <Card className="smile-card smile-card--expanded">
                      <div className="smile-card__header smile-card__header--expanded">
                        <div className="smile-card__title-row">
                          <div>
                            <div className="smile-card__title-with-badges">
                              <div className="smile-card__title smile-card__title--expanded">{expandedRow.label}</div>
                              <SmileExchangeBadges
                                hasDeribit={expandedRow.hasDeribit}
                                hasOkx={expandedRow.hasOkx}
                              />
                            </div>
                            <SmileAtmBadge atm={expandedRow.atm} />
                          </div>
                          <button
                            type="button"
                            className="smile-focus__close"
                            onClick={() => setExpandedExpiry(null)}
                          >
                            Back to matrix
                          </button>
                        </div>
                      </div>

                      <SmileCanvasChart
                        key={`smile-expanded-${expandedRow.expiry}-${smileXAxisMode}-${exchangeVisibilityKey}`}
                        height={focusChartHeight}
                        xLabel={smileXAxisMode === "strike" ? "strike" : "log-moneyness"}
                        row={expandedRow}
                        lineColor={FITTED_CURVE_COLOR}
                        hoverX={hoverX}
                        onHoverX={setHoverX}
                      />
                    </Card>
                  </div>
                </div>
              ) : (
                <div ref={scrollRef} className="smile-grid-scroll">
                  <div style={{ height: topSpacer }} />

                  <div
                    className="smile-grid"
                    style={{
                      gridTemplateColumns:
                        columnCount >= 3
                          ? "repeat(3, minmax(0, 1fr))"
                          : columnCount === 2
                            ? "repeat(2, minmax(0, 1fr))"
                            : "minmax(0, 1fr)",
                    }}
                  >
                    {visibleRows.map((row) => {
                      return (
                        <div key={row.expiry} style={{ minWidth: 0 }}>
                          <button
                            type="button"
                            className="smile-card-button"
                            onClick={() => setExpandedExpiry(row.expiry)}
                          >
                            <Card className="smile-card">
                              <div className="smile-card__header">
                              <div className="smile-card__title-row">
                                <div className="smile-card__title-with-badges">
                                  <div className="smile-card__title">{row.label}</div>
                                  <SmileExchangeBadges hasDeribit={row.hasDeribit} hasOkx={row.hasOkx} />
                                </div>
                                <SmileAtmBadge atm={row.atm} className="smile-atm--inline" />
                              </div>
                              </div>

                              <SmileCanvasChart
                                key={`smile-grid-${row.expiry}-${smileXAxisMode}-${exchangeVisibilityKey}`}
                                height={chartHeight}
                                xLabel={smileXAxisMode === "strike" ? "strike" : "log-moneyness"}
                                row={row}
                                lineColor={FITTED_CURVE_COLOR}
                                hoverX={hoverX}
                                onHoverX={setHoverX}
                              />
                            </Card>
                          </button>
                        </div>
                      );
                    })}
                  </div>

                  <div style={{ height: bottomSpacer }} />
                </div>
              )}
            </>
          ) : null}
        </div>
      </div>
      <RuntimeDebugPanel
        mountedSmileCharts={mountedSmileChartCount}
        visibleSmileCharts={visibleSmileChartCount}
      />
    </div>
  );
}
