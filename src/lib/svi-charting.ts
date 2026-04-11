import type {
  CurveRow,
  Margin,
  QuotesByExpiry,
  ScatterRow,
  SmileChartRow,
  SmilePointUpdateMessage,
  SmileSnapshotMessage,
  SviSmile,
  SviSurfaceSnapshot,
  VarianceSeries,
} from "./svi-types";

export const FALLBACK_WS_URL = "ws://localhost:8765";
export const RECONNECT_DELAYS_MS = [2000, 4000, 8000, 15000];
export const MAX_BID_POINTS_PER_SMILE = 120;
export const MAX_ASK_POINTS_PER_SMILE = 120;

export const palette = [
  "#06b6d4",
  "#f59e0b",
  "#22c55e",
  "#8b5cf6",
  "#ef4444",
  "#3b82f6",
  "#14b8a6",
  "#f97316",
  "#84cc16",
  "#ec4899",
  "#0ea5e9",
  "#e11d48",
  "#7c3aed",
  "#0891b2",
  "#65a30d",
  "#ea580c",
];

export function formatExpiry(expiry: number, label?: string) {
  if (label) return label;
  try {
    return new Date(expiry).toLocaleDateString();
  } catch {
    return String(expiry);
  }
}

export function formatTs(ts: number | null) {
  if (!ts) return "—";
  return new Date(ts).toLocaleTimeString();
}

export function safeNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function normalizeIvForChart(value: unknown): number | null {
  const normalized = safeNumber(value);
  if (normalized == null) return null;
  return Math.abs(normalized) <= 5 ? normalized * 100 : normalized;
}

export function safeDomain(
  min: number,
  max: number,
  fallback: [number, number]
): [number, number] {
  if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) {
    return fallback;
  }

  return [min, max];
}

export function snapDown(value: number, step: number) {
  return Math.floor(value / step) * step;
}

export function snapUp(value: number, step: number) {
  return Math.ceil(value / step) * step;
}

export function chooseTickStep(range: number, candidates: number[], targetTicks = 6) {
  if (!Number.isFinite(range) || range <= 0) return candidates[0];
  const ideal = range / targetTicks;

  for (const candidate of candidates) {
    if (candidate >= ideal) return candidate;
  }

  return candidates[candidates.length - 1];
}

export function buildTicks(min: number, max: number, step: number) {
  if (!Number.isFinite(min) || !Number.isFinite(max) || !Number.isFinite(step) || step <= 0) {
    return [];
  }

  const ticks: number[] = [];
  for (let value = min; value <= max + step * 0.5; value += step) {
    ticks.push(Number(value.toFixed(10)));
  }

  return ticks;
}

export function getOpacityFromSizeRelative(
  size: number | null | undefined,
  maxSize: number,
  minOpacity = 0.12,
  maxOpacity = 0.72
) {
  if (size == null || !Number.isFinite(size) || size <= 0) return minOpacity;
  if (!Number.isFinite(maxSize) || maxSize <= 0) return minOpacity;

  const scaled = Math.log(size + 1) / Math.log(maxSize + 1);
  const clamped = Math.max(0, Math.min(1, scaled));
  return minOpacity + clamped * (maxOpacity - minOpacity);
}

export function getRadiusFromSizeRelative(
  size: number | null | undefined,
  maxSize: number,
  minRadius = 1.8,
  maxRadius = 3.2
) {
  if (size == null || !Number.isFinite(size) || size <= 0) return minRadius;
  if (!Number.isFinite(maxSize) || maxSize <= 0) return minRadius;

  const scaled = Math.log(size + 1) / Math.log(maxSize + 1);
  const clamped = Math.max(0, Math.min(1, scaled));
  return minRadius + clamped * (maxRadius - minRadius);
}

export function resolveSmileXValues(smile: SviSmile, snapshot: SviSurfaceSnapshot | null): number[] {
  if (Array.isArray(smile.x_axis?.values) && smile.x_axis.values.length > 0) {
    return smile.x_axis.values;
  }

  if (Array.isArray(smile.x_values) && smile.x_values.length > 0) {
    return smile.x_values;
  }

  if (Array.isArray(snapshot?.x_axis?.values) && snapshot.x_axis.values.length > 0) {
    const globalX = snapshot.x_axis.values;
    const volLen = Array.isArray(smile.vol) ? smile.vol.length : 0;
    return volLen > 0 ? globalX.slice(0, volLen) : globalX;
  }

  return [];
}

export function applySmileSnapshot(current: QuotesByExpiry, msg: SmileSnapshotMessage): QuotesByExpiry {
  const expiryKey = String(msg.expiry);
  const existing = current[expiryKey];

  if (existing && msg.ts < existing.ts) {
    return current;
  }

  const pointsByStrike: Record<string, typeof msg.points[number]> = {};
  for (const point of msg.points ?? []) {
    pointsByStrike[String(point.strike)] = point;
  }

  return {
    ...current,
    [expiryKey]: {
      ts: msg.ts,
      label: msg.label ?? existing?.label,
      pointsByStrike,
    },
  };
}

export function applySmilePointUpdate(
  current: QuotesByExpiry,
  msg: SmilePointUpdateMessage
): QuotesByExpiry {
  const expiryKey = String(msg.expiry);
  const existing = current[expiryKey];

  if (existing && msg.ts < existing.ts) {
    return current;
  }

  const nextPointsByStrike = { ...(existing?.pointsByStrike ?? {}) };
  for (const point of msg.points ?? []) {
    nextPointsByStrike[String(point.strike)] = point;
  }

  return {
    ...current,
    [expiryKey]: {
      ts: msg.ts,
      label: msg.label ?? existing?.label,
      pointsByStrike: nextPointsByStrike,
    },
  };
}

export function pruneQuotesBySnapshot(
  current: QuotesByExpiry,
  snapshot: SviSurfaceSnapshot
): QuotesByExpiry {
  const allowedExpiries = new Set(snapshot.smiles.map((smile) => String(smile.expiry)));
  const next: QuotesByExpiry = {};

  for (const [expiryKey, quoteState] of Object.entries(current)) {
    if (allowedExpiries.has(expiryKey)) {
      next[expiryKey] = quoteState;
    }
  }

  return next;
}

function downsampleScatter(points: ScatterRow[], maxPoints = 120) {
  if (points.length <= maxPoints) return points;
  const step = points.length / maxPoints;
  return Array.from({ length: maxPoints }, (_, idx) => points[Math.floor(idx * step)]);
}

export function buildVarianceSeries(snapshot: SviSurfaceSnapshot | null): VarianceSeries[] {
  if (!snapshot) return [];

  return snapshot.smiles.map((smile, idx) => {
    const xValues = resolveSmileXValues(smile, snapshot);

    return {
      key: String(smile.expiry),
      label: formatExpiry(smile.expiry, smile.label),
      color: palette[idx % palette.length],
      data: xValues.map((x, pointIdx) => ({
        x,
        y: smile.var?.[pointIdx] ?? null,
      })),
    };
  });
}

export function buildVarianceXDomain(snapshot: SviSurfaceSnapshot | null): [number, number] {
  if (!snapshot) return [-1, 1];

  const xs = snapshot.smiles.flatMap((smile) => resolveSmileXValues(smile, snapshot));
  if (xs.length === 0) return [-1, 1];

  return safeDomain(snapDown(Math.min(...xs), 0.05), snapUp(Math.max(...xs), 0.05), [-1, 1]);
}

export function buildVarianceYDomain(series: VarianceSeries[]): [number, number] {
  const ys = series.flatMap((item) =>
    item.data.map((point) => point.y).filter((value): value is number => value != null)
  );

  if (ys.length === 0) return [0, 1];

  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const pad = Math.max((maxY - minY) * 0.12, 0.001);
  return safeDomain(snapDown(minY - pad, 0.005), snapUp(maxY + pad, 0.005), [0, 1]);
}

export function buildSmileChartRows(
  snapshot: SviSurfaceSnapshot | null,
  quotesByExpiry: QuotesByExpiry
): SmileChartRow[] {
  if (!snapshot) return [];

  return snapshot.smiles.map((smile) => {
    const expiryKey = String(smile.expiry);
    const quoteState = quotesByExpiry[expiryKey];
    const quotePoints = quoteState ? Object.values(quoteState.pointsByStrike) : [];

    const rawBidScatter: ScatterRow[] = quotePoints.flatMap((point) => {
      const x = safeNumber(point.log_moneyness);
      if (x == null) return [];

      return (point.bid_levels ?? [])
        .map((level, levelIdx) => {
          const y = normalizeIvForChart(level.iv);
          if (y == null) return null;
          return {
            x,
            y,
            strike: point.strike,
            level: levelIdx,
            side: "bid" as const,
            size: level.size,
          };
        })
        .filter(Boolean) as ScatterRow[];
    });

    const rawAskScatter: ScatterRow[] = quotePoints.flatMap((point) => {
      const x = safeNumber(point.log_moneyness);
      if (x == null) return [];

      return (point.ask_levels ?? [])
        .map((level, levelIdx) => {
          const y = normalizeIvForChart(level.iv);
          if (y == null) return null;
          return {
            x,
            y,
            strike: point.strike,
            level: levelIdx,
            side: "ask" as const,
            size: level.size,
          };
        })
        .filter(Boolean) as ScatterRow[];
    });

    const fullCurveData: CurveRow[] = resolveSmileXValues(smile, snapshot).map((x, idx) => ({
      x,
      y: normalizeIvForChart(smile.vol?.[idx]),
    }));

    if (fullCurveData.length === 0) {
      return {
        expiry: smile.expiry,
        label: smile.label || formatExpiry(smile.expiry),
        readableExpiry: formatExpiry(smile.expiry, smile.label),
        curveData: [],
        bidScatter: [],
        askScatter: [],
        quotePointCount: quotePoints.length,
        bidLevelCount: rawBidScatter.length,
        askLevelCount: rawAskScatter.length,
        plottedBidLevelCount: 0,
        plottedAskLevelCount: 0,
        xDomain: [-1, 1],
        yDomain: [0, 100],
        xTicks: [],
        yTicks: [],
        maxVisibleSize: 1,
        atmX: null,
      };
    }

    const quoteXs = [...rawBidScatter.map((point) => point.x), ...rawAskScatter.map((point) => point.x)];

    let xMin: number;
    let xMax: number;
    if (quoteXs.length > 0) {
      const minQuoteX = Math.min(...quoteXs);
      const maxQuoteX = Math.max(...quoteXs);
      const xPad = Math.max((maxQuoteX - minQuoteX) * 0.08, 0.02);
      xMin = snapDown(minQuoteX - xPad, 0.05);
      xMax = snapUp(maxQuoteX + xPad, 0.05);
    } else {
      const fullXs = fullCurveData.map((point) => point.x);
      xMin = snapDown(Math.min(...fullXs), 0.05);
      xMax = snapUp(Math.max(...fullXs), 0.05);
    }

    const curveData = fullCurveData.filter((point) => point.x >= xMin && point.x <= xMax);
    const bidScatter = rawBidScatter.filter((point) => point.x >= xMin && point.x <= xMax);
    const askScatter = rawAskScatter.filter((point) => point.x >= xMin && point.x <= xMax);

    const curveYValues = curveData
      .map((point) => point.y)
      .filter((value): value is number => value != null && Number.isFinite(value));

    const curveMinRaw = curveYValues.length ? Math.min(...curveYValues) : 0;
    const curveMaxRaw = curveYValues.length ? Math.max(...curveYValues) : 100;
    const yPad = Math.max((curveMaxRaw - curveMinRaw) * 0.15, 2);
    const yMin = snapDown(Math.max(0, curveMinRaw - yPad), 5);
    const yMax = snapUp(curveMaxRaw + yPad, 5);

    const visibleYPad = Math.max((yMax - yMin) * 0.1, 2);
    const visibleLower = yMin - visibleYPad;
    const visibleUpper = yMax + visibleYPad;

    const visibleBidScatter = bidScatter.filter(
      (point) => point.y >= visibleLower && point.y <= visibleUpper
    );
    const visibleAskScatter = askScatter.filter(
      (point) => point.y >= visibleLower && point.y <= visibleUpper
    );

    const renderedBidScatter = downsampleScatter(visibleBidScatter, MAX_BID_POINTS_PER_SMILE);
    const renderedAskScatter = downsampleScatter(visibleAskScatter, MAX_ASK_POINTS_PER_SMILE);

    const visibleSizes = [...renderedBidScatter, ...renderedAskScatter]
      .map((point) => point.size)
      .filter((size): size is number => size != null && Number.isFinite(size) && size > 0);

    const xDomain = safeDomain(xMin, xMax, [-1, 1]);
    const yDomain = safeDomain(yMin, yMax, [0, 100]);

    const xTickStep = chooseTickStep(xDomain[1] - xDomain[0], [0.05, 0.1, 0.2, 0.25, 0.5, 1], 6);
    const yTickStep = chooseTickStep(yDomain[1] - yDomain[0], [5, 10, 15, 20, 25, 50], 6);

    const atmPoint = curveData.reduce<CurveRow | null>((best, current) => {
      if (!best) return current;
      return Math.abs(current.x) < Math.abs(best.x) ? current : best;
    }, null);

    return {
      expiry: smile.expiry,
      label: smile.label || formatExpiry(smile.expiry),
      readableExpiry: formatExpiry(smile.expiry, smile.label),
      curveData,
      bidScatter: renderedBidScatter,
      askScatter: renderedAskScatter,
      quotePointCount: quotePoints.length,
      bidLevelCount: rawBidScatter.length,
      askLevelCount: rawAskScatter.length,
      plottedBidLevelCount: renderedBidScatter.length,
      plottedAskLevelCount: renderedAskScatter.length,
      xDomain,
      yDomain,
      xTicks: buildTicks(xDomain[0], xDomain[1], xTickStep),
      yTicks: buildTicks(yDomain[0], yDomain[1], yTickStep),
      maxVisibleSize: visibleSizes.length ? Math.max(...visibleSizes) : 1,
      atmX: atmPoint?.x ?? null,
    };
  });
}

export function makeXScale(domain: [number, number], width: number, margin: Margin) {
  const plotWidth = Math.max(1, width - margin.left - margin.right);
  const [xmin, xmax] = domain;
  const denominator = xmax - xmin || 1;
  return (x: number) => margin.left + ((x - xmin) / denominator) * plotWidth;
}

export function makeYScale(domain: [number, number], height: number, margin: Margin) {
  const plotHeight = Math.max(1, height - margin.top - margin.bottom);
  const [ymin, ymax] = domain;
  const denominator = ymax - ymin || 1;
  return (y: number) => height - margin.bottom - ((y - ymin) / denominator) * plotHeight;
}

export function invertX(px: number, domain: [number, number], width: number, margin: Margin) {
  const plotWidth = Math.max(1, width - margin.left - margin.right);
  const clamped = Math.min(width - margin.right, Math.max(margin.left, px));
  const ratio = (clamped - margin.left) / plotWidth;
  return domain[0] + ratio * (domain[1] - domain[0]);
}

export function hexToRgba(hex: string, alpha: number) {
  const clean = hex.replace("#", "");
  const bigint = parseInt(clean, 16);
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
