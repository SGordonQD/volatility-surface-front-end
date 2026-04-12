import {
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
import {
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
import type { CurveRow, ScatterRow, SmileChartRow } from "./lib/svi-types";

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
    </header>
  );
}

function formatAtm(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "ATM --";
  return `ATM ${new Intl.NumberFormat("en-GB", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)}`;
}

function formatStrike(value: number) {
  return new Intl.NumberFormat("en-GB", {
    maximumFractionDigits: 0,
  }).format(value);
}

type SmileXAxisMode = "log_moneyness" | "strike";

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
  const bestBidScatter = toStrikeScatter(row.bestBidScatter, referencePrice, strikeMappingPoints);
  const bestAskScatter = toStrikeScatter(row.bestAskScatter, referencePrice, strikeMappingPoints);
  const lastTradeScatter = toStrikeScatter(row.lastTradeScatter, referencePrice, strikeMappingPoints);

  const scatterXValues = [
    ...bidScatter.map((point) => point.x),
    ...askScatter.map((point) => point.x),
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
  if (!Number.isFinite(rangeRatio) || rangeRatio > 4) {
    return next;
  }

  const shrinkBlend = 0.18;
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

function SmileAtmBadge({ atm, className = "" }: { atm: number | null | undefined; className?: string }) {
  const [flashClass, setFlashClass] = useState("");
  const previousAtmRef = useRef<number | null>(null);

  useEffect(() => {
    if (atm == null || !Number.isFinite(atm)) return;

    const previousAtm = previousAtmRef.current;
    previousAtmRef.current = atm;

    if (previousAtm == null || previousAtm === atm) return;

    setFlashClass(atm > previousAtm ? "smile-atm--up" : "smile-atm--down");
    const timeoutId = window.setTimeout(() => setFlashClass(""), 520);
    return () => window.clearTimeout(timeoutId);
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
}: {
  hoverX: number | null;
  onHoverX: (x: number | null) => void;
  scaleMode: "auto" | "focus";
  onScaleModeChange: (mode: "auto" | "focus") => void;
  series: ReturnType<typeof buildVarianceSeries>;
  snapshotKind: string;
  snapshotCcy: string;
  smileCount: number;
  varHeight: number;
  xDomain: [number, number];
  xTicks: number[];
  yDomain: [number, number];
  yTicks: number[];
}) {
  return (
    <div style={{ gridColumn: "1 / -1", minWidth: 0 }}>
      <Card className="overview-card">
        <div className="panel-heading">
          <h3 className="panel-heading__title">Variance Surface</h3>
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
                className={`scale-toggle__button ${scaleMode === "auto" ? "is-active" : ""}`}
                onClick={() => onScaleModeChange("auto")}
              >
                Auto
              </button>
            </div>
            <div className="panel-heading__meta">
              {snapshotCcy} / {snapshotKind} / {smileCount} smiles
            </div>
          </div>
        </div>

        <VarianceCanvasChart
          height={varHeight}
          xLabel={snapshotKind}
          series={series}
          xDomain={xDomain}
          yDomain={yDomain}
          xTicks={xTicks}
          yTicks={yTicks}
          hoverX={hoverX}
          onHoverX={onHoverX}
        />
      </Card>
    </div>
  );
}

function ThroughMatrixPanel({
  matrix,
}: {
  matrix: ReturnType<typeof buildSmileThroughMatrix>;
}) {
  if (matrix.rows.length === 0 || matrix.strikes.length === 0) return null;

  const wrapRef = useRef<HTMLDivElement>(null);
  const wrapWidth = useContainerWidth(wrapRef);
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
                    const intensity = cell ? Math.min(1, cell.throughValue / maxThrough) : 0;
                    const fillColor =
                      side === "bid"
                        ? `rgba(76, 184, 112, ${0.2 + intensity * 0.58})`
                        : side === "ask"
                          ? `rgba(231, 113, 80, ${0.2 + intensity * 0.58})`
                          : "rgba(100, 114, 133, 0.28)";

                    const title = cell
                      ? `${row.label} | K ${formatStrike(strike)} | SVI ${cell.sviIv?.toFixed(2) ?? "--"} | BID ${cell.bestBidIv?.toFixed(2) ?? "--"} | ASK ${cell.bestAskIv?.toFixed(2) ?? "--"}`
                      : `${row.label} | K ${formatStrike(strike)} | no quote`;

                    return (
                      <td
                        key={key}
                        className={`through-matrix__cell through-matrix__cell--${side}`}
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
}

export default function App() {
  const outerRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const outerWidth = useContainerWidth(outerRef);
  const viewportHeight = useViewportHeight();
  const columnCount = getColumnCount(outerWidth);

  const chartHeight = columnCount >= 3 ? 320 : columnCount === 2 ? 340 : 360;
  const varHeight = columnCount >= 3 ? 420 : 430;

  const [hoverX, setHoverX] = useState<number | null>(null);
  const [expandedExpiry, setExpandedExpiry] = useState<number | null>(null);
  const [varianceScaleMode, setVarianceScaleMode] = useState<"auto" | "focus">("focus");
  const [smileXAxisMode, setSmileXAxisMode] = useState<SmileXAxisMode>("log_moneyness");
  const [tradeAlert, setTradeAlert] = useState<{ id: number; message: string } | null>(null);
  const [tradeAlertVisible, setTradeAlertVisible] = useState(false);
  const lastTradeAlertKeyRef = useRef<string>("");
  const {
    connected,
    currentFitError,
    lastFitError,
    lastFitElapsedSeconds,
    lastSnapshotUpdated,
    quotesByExpiry,
    reconnectAttempt,
    snapshot,
  } = useSviFeed();

  const varianceSeries = useMemo(() => buildVarianceSeries(snapshot), [snapshot]);
  const varianceAutoXDomain = useMemo(() => buildVarianceXDomain(snapshot), [snapshot]);
  const varianceXDomain = useMemo<[number, number]>(() => {
    if (varianceScaleMode === "focus") return [-2, 2];
    return varianceAutoXDomain;
  }, [varianceAutoXDomain, varianceScaleMode]);
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
  const varianceRawYDomain = useMemo(
    () => buildVarianceYDomain(varianceWindowedSeries),
    [varianceWindowedSeries]
  );
  const varianceDomainRef = useRef<[number, number] | null>(null);
  const varianceYDomain = useMemo<[number, number]>(() => {
    const previous = varianceDomainRef.current;
    const next = previous ? smoothVarianceDomain(previous, varianceRawYDomain) : varianceRawYDomain;
    varianceDomainRef.current = next;
    return next;
  }, [varianceRawYDomain]);
  const varianceXTicks = useMemo(() => {
    const step = chooseTickStep(varianceXDomain[1] - varianceXDomain[0], [0.05, 0.1, 0.2, 0.25, 0.5, 1], 7);
    return buildTicks(varianceXDomain[0], varianceXDomain[1], step);
  }, [varianceXDomain]);
  const varianceYTicks = useMemo(() => {
    const step = chooseTickStep(
      varianceYDomain[1] - varianceYDomain[0],
      [0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.25, 0.5],
      6
    );
    return buildTicks(varianceYDomain[0], varianceYDomain[1], step);
  }, [varianceYDomain]);

  const smileChartRows = useMemo(() => buildSmileChartRows(snapshot, quotesByExpiry), [quotesByExpiry, snapshot]);
  const smileDisplayRows = useMemo(
    () => smileChartRows.map((row) => projectSmileRowXAxis(row, smileXAxisMode)),
    [smileChartRows, smileXAxisMode]
  );
  const throughMatrix = useMemo(
    () => buildSmileThroughMatrix(snapshot, quotesByExpiry),
    [snapshot, quotesByExpiry]
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
    if (!smileDisplayRows.some((row) => row.expiry === expandedExpiry)) {
      setExpandedExpiry(null);
    }
  }, [expandedExpiry, smileDisplayRows]);

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
    setTradeAlert(nextAlert);
    setTradeAlertVisible(false);

    const showRaf = window.requestAnimationFrame(() => {
      setTradeAlertVisible(true);
    });
    const fadeTimeout = window.setTimeout(() => {
      setTradeAlertVisible(false);
    }, 2200);
    const clearTimeout = window.setTimeout(() => {
      setTradeAlert((current) => (current?.id === nextAlert.id ? null : current));
    }, 2900);

    return () => {
      window.cancelAnimationFrame(showRaf);
      window.clearTimeout(fadeTimeout);
      window.clearTimeout(clearTimeout);
    };
  }, [smileChartRows]);

  const rowHeight = chartHeight + 88;
  const rowCount = Math.ceil(smileDisplayRows.length / columnCount);
  const [startRow, endRow] = useVirtualGrid({
    itemCount: rowCount,
    itemHeight: rowHeight,
    containerRef: scrollRef,
    overscan: 2,
  });

  const start = startRow * columnCount;
  const end = endRow * columnCount;
  const visibleRows = smileDisplayRows.slice(start, end);
  const topSpacer = startRow * rowHeight;
  const bottomSpacer = Math.max(0, (rowCount - endRow) * rowHeight);
  const focusChartHeight = Math.max(420, viewportHeight - 340);

  return (
    <div className="app-shell">
      {tradeAlert ? (
        <div className={`trade-alert ${tradeAlertVisible ? "is-visible" : ""}`} role="status" aria-live="polite">
          {tradeAlert.message}
        </div>
      ) : null}

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
      />

      <div ref={outerRef} className="app-layout">
        <div className="app-layout__inner">
          <VariancePanel
            hoverX={hoverX}
            onHoverX={setHoverX}
            scaleMode={varianceScaleMode}
            onScaleModeChange={setVarianceScaleMode}
            series={varianceSeries}
            snapshotKind={snapshot?.x_axis?.kind ?? "x"}
            snapshotCcy={snapshot?.ccy ?? "—"}
            smileCount={snapshot?.smiles.length ?? 0}
            varHeight={varHeight}
            xDomain={varianceXDomain}
            xTicks={varianceXTicks}
            yDomain={varianceYDomain}
            yTicks={varianceYTicks}
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
              <div className="smile-section__caption">
                Per-expiry quoted levels against fitted volatility slices
              </div>
            </div>
          </div>

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
                      <div className="smile-queue__title">{row.label}</div>
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
                        <div className="smile-card__title smile-card__title--expanded">{expandedRow.label}</div>
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
                            <div className="smile-card__title">{row.label}</div>
                            <SmileAtmBadge atm={row.atm} className="smile-atm--inline" />
                          </div>
                          </div>

                          <SmileCanvasChart
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
        </div>
      </div>
    </div>
  );
}
