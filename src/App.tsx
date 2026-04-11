import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from "react";

import { SmileCanvasChart, VarianceCanvasChart } from "./components/CanvasCharts";
import {
  buildSmileChartRows,
  buildTicks,
  buildVarianceSeries,
  buildVarianceXDomain,
  buildVarianceYDomain,
  chooseTickStep,
  formatTs,
  palette,
} from "./lib/svi-charting";
import { useSviFeed } from "./hooks/useSviFeed";

function Card({
  children,
  style = {},
}: {
  children: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <div
      style={{
        background: "linear-gradient(180deg, #ffffff 0%, #f8fafc 100%)",
        border: "1px solid #e2e8f0",
        borderRadius: 18,
        boxShadow: "0 10px 30px rgba(15, 23, 42, 0.06)",
        padding: 16,
        minWidth: 0,
        ...style,
      }}
    >
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
  lastSnapshotUpdated,
  reconnectAttempt,
  statusText,
}: {
  connected: boolean;
  currentFitError: number | null;
  lastFitError: number | null;
  lastSnapshotUpdated: number | null;
  reconnectAttempt: number;
  statusText: string;
}) {
  return (
    <div
      style={{
        position: "sticky",
        top: 0,
        zIndex: 100,
        background: "rgba(255,255,255,0.95)",
        backdropFilter: "blur(8px)",
        borderBottom: "1px solid #e2e8f0",
        padding: "10px 16px",
        display: "flex",
        flexWrap: "wrap",
        gap: 24,
        fontSize: 13,
        color: "#334155",
      }}
    >
      <div>
        <b>WS:</b>{" "}
        <span style={{ color: connected ? "#16a34a" : "#dc2626" }}>
          {connected ? "Connected" : "Disconnected"}
        </span>
      </div>

      <div>
        <b>SVI:</b> {formatTs(lastSnapshotUpdated)}
      </div>

      <div>
        <b>Last Fit:</b>{" "}
        <span style={{ color: "#0369a1" }}>
          {lastFitError != null ? lastFitError.toFixed(4) : "—"}
        </span>
      </div>

      <div>
        <b>Current:</b>{" "}
        <span
          style={{
            color:
              currentFitError != null && lastFitError != null
                ? currentFitError > lastFitError
                  ? "#dc2626"
                  : "#16a34a"
                : "#334155",
          }}
        >
          {currentFitError != null ? currentFitError.toFixed(4) : "—"}
        </span>
      </div>

      <div>
        <b>Status:</b> {statusText}
      </div>

      {!connected && reconnectAttempt > 0 ? (
        <div>
          <b>Retry:</b> #{reconnectAttempt}
        </div>
      ) : null}
    </div>
  );
}

function VariancePanel({
  hoverX,
  onHoverX,
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
    <div style={{ gridColumn: "1 / -1", minWidth: 0, marginBottom: 16 }}>
      <Card>
        <div style={{ marginBottom: 10 }}>
          <h3 style={{ margin: 0 }}>
            Variance Surface
            <span
              style={{
                marginLeft: 10,
                fontSize: 12,
                fontWeight: 500,
                color: "#64748b",
              }}
            >
              {snapshotCcy} · {snapshotKind} · {smileCount} smiles
            </span>
          </h3>
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

export default function App() {
  const outerRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const outerWidth = useContainerWidth(outerRef);
  const columnCount = getColumnCount(outerWidth);

  const chartHeight = columnCount >= 3 ? 320 : columnCount === 2 ? 340 : 360;
  const varHeight = columnCount >= 3 ? 420 : 430;

  const [hoverX, setHoverX] = useState<number | null>(null);
  const {
    connected,
    currentFitError,
    lastFitError,
    lastSnapshotUpdated,
    quotesByExpiry,
    reconnectAttempt,
    snapshot,
    statusText,
  } = useSviFeed();

  const varianceSeries = useMemo(() => buildVarianceSeries(snapshot), [snapshot]);
  const varianceXDomain = useMemo(() => buildVarianceXDomain(snapshot), [snapshot]);
  const varianceYDomain = useMemo(() => buildVarianceYDomain(varianceSeries), [varianceSeries]);
  const varianceXTicks = useMemo(() => {
    const step = chooseTickStep(varianceXDomain[1] - varianceXDomain[0], [0.05, 0.1, 0.2, 0.25, 0.5, 1], 8);
    return buildTicks(varianceXDomain[0], varianceXDomain[1], step);
  }, [varianceXDomain]);
  const varianceYTicks = useMemo(() => {
    const step = chooseTickStep(varianceYDomain[1] - varianceYDomain[0], [0.005, 0.01, 0.02, 0.05, 0.1], 6);
    return buildTicks(varianceYDomain[0], varianceYDomain[1], step);
  }, [varianceYDomain]);

  const smileChartRows = useMemo(() => buildSmileChartRows(snapshot, quotesByExpiry), [quotesByExpiry, snapshot]);

  const rowHeight = chartHeight + 120;
  const rowCount = Math.ceil(smileChartRows.length / columnCount);
  const [startRow, endRow] = useVirtualGrid({
    itemCount: rowCount,
    itemHeight: rowHeight,
    containerRef: scrollRef,
    overscan: 2,
  });

  const start = startRow * columnCount;
  const end = endRow * columnCount;
  const visibleRows = smileChartRows.slice(start, end);
  const topSpacer = startRow * rowHeight;
  const bottomSpacer = Math.max(0, (rowCount - endRow) * rowHeight);

  return (
    <div className="min-h-screen w-full bg-slate-50">
      <DashboardHeader
        connected={connected}
        currentFitError={currentFitError}
        lastFitError={lastFitError}
        lastSnapshotUpdated={lastSnapshotUpdated}
        reconnectAttempt={reconnectAttempt}
        statusText={statusText}
      />

      <div ref={outerRef} style={{ width: "100%", padding: 16, boxSizing: "border-box" }}>
        <div style={{ width: "100%", maxWidth: 1600, margin: "0 auto" }}>
          <VariancePanel
            hoverX={hoverX}
            onHoverX={setHoverX}
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

          <div
            ref={scrollRef}
            style={{
              height: "100%",
              maxHeight: "calc(100vh - 140px)",
              overflowY: "auto",
            }}
          >
            <div style={{ height: topSpacer }} />

            <div
              style={{
                display: "grid",
                width: "100%",
                gap: 16,
                gridTemplateColumns:
                  columnCount >= 3
                    ? "repeat(3, minmax(0, 1fr))"
                    : columnCount === 2
                      ? "repeat(2, minmax(0, 1fr))"
                      : "minmax(0, 1fr)",
              }}
            >
              {visibleRows.length === 0 && smileChartRows.length === 0 ? (
                <div style={{ gridColumn: "1 / -1", minWidth: 0 }}>
                  <Card>
                    <div style={{ fontSize: 14, color: "#64748b" }}>No volatility smile data yet.</div>
                  </Card>
                </div>
              ) : (
                visibleRows.map((row, idx) => {
                  const paletteIndex = start + idx;

                  return (
                    <div key={row.expiry} style={{ minWidth: 0 }}>
                      <Card>
                        <div style={{ textAlign: "center", marginBottom: 8 }}>
                          <div style={{ fontWeight: 700, fontSize: 16 }}>{row.label}</div>
                          <div style={{ fontSize: 11, color: "#64748b" }}>{row.readableExpiry}</div>
                          <div style={{ fontSize: 10, color: "#94a3b8" }}>
                            strikes={row.quotePointCount} · bid={row.plottedBidLevelCount}/{row.bidLevelCount} · ask=
                            {row.plottedAskLevelCount}/{row.askLevelCount}
                          </div>
                        </div>

                        <SmileCanvasChart
                          height={chartHeight}
                          xLabel={snapshot?.x_axis?.kind ?? "x"}
                          row={row}
                          lineColor={palette[paletteIndex % palette.length]}
                          hoverX={hoverX}
                          onHoverX={setHoverX}
                        />
                      </Card>
                    </div>
                  );
                })
              )}
            </div>

            <div style={{ height: bottomSpacer }} />
          </div>
        </div>
      </div>
    </div>
  );
}
