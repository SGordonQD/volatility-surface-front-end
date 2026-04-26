import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent, type RefObject } from "react";

import {
  getOpacityFromSizeRelative,
  getRadiusFromSizeRelative,
  hexToRgba,
  invertX,
  makeXScale,
  makeYScale,
} from "../lib/svi-charting";
import type { CurveRow, Margin, ScatterRow, SmileChartRow, VarianceSeries } from "../lib/svi-types";

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

function dprSize(canvas: HTMLCanvasElement, width: number, height: number) {
  const dpr = window.devicePixelRatio || 1;
  const pixelWidth = Math.max(1, Math.floor(width * dpr));
  const pixelHeight = Math.max(1, Math.floor(height * dpr));

  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
  }

  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

function lerp(start: number, end: number, t: number) {
  return start + (end - start) * t;
}

function easeOutCubic(t: number) {
  return 1 - Math.pow(1 - t, 3);
}

const TRADE_FLASH_DURATION_MS = 10_000;
const TRADE_FADE_OUT_DURATION_MS = 120_000;
const TRADE_MOTION_TICK_MS = 1_000;
const MAX_ANIMATED_SCATTER_POINTS = 900;
const STRIKE_TICK_FORMATTER = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 0 });

const tradeMotionSubscribers = new Set<() => void>();
let tradeMotionTimerId: number | null = null;

function ensureTradeMotionTimer() {
  if (tradeMotionTimerId != null || typeof window === "undefined") return;
  tradeMotionTimerId = window.setInterval(() => {
    for (const notify of tradeMotionSubscribers) {
      notify();
    }
  }, TRADE_MOTION_TICK_MS);
}

function cleanupTradeMotionTimer() {
  if (tradeMotionSubscribers.size > 0) return;
  if (tradeMotionTimerId == null || typeof window === "undefined") return;
  window.clearInterval(tradeMotionTimerId);
  tradeMotionTimerId = null;
}

function useElementVisible(ref: RefObject<HTMLElement | null>) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const element = ref.current;
    if (!element || typeof IntersectionObserver === "undefined") return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        setVisible(entry.isIntersecting);
      },
      { rootMargin: "180px" }
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);

  return visible;
}

function resolveTradeMotionEndMs(data: ScatterRow[]) {
  let endMs = 0;
  for (const point of data) {
    if (point.flashUntilTs != null && Number.isFinite(point.flashUntilTs)) {
      endMs = Math.max(endMs, point.flashUntilTs);
    }
    if (point.tradeUpdateTs != null && Number.isFinite(point.tradeUpdateTs)) {
      endMs = Math.max(endMs, point.tradeUpdateTs + TRADE_FADE_OUT_DURATION_MS);
    }
  }
  return endMs;
}

function useTradeMotionNow(data: ScatterRow[], visible: boolean) {
  const [nowMs, setNowMs] = useState(0);
  const motionEndMs = useMemo(() => resolveTradeMotionEndMs(data), [data]);
  const enabled = visible && motionEndMs > nowMs;

  useEffect(() => {
    if (!enabled) return;

    const notify = () => {
      setNowMs(Date.now());
    };
    notify();
    tradeMotionSubscribers.add(notify);
    ensureTradeMotionTimer();

    return () => {
      tradeMotionSubscribers.delete(notify);
      cleanupTradeMotionTimer();
    };
  }, [enabled]);

  return nowMs;
}

function recordCanvasFrame(kind: string, startedAt: number) {
  if (typeof window === "undefined") return;
  const elapsedMs = performance.now() - startedAt;
  const target = window as Window & {
    __SVI_RENDER_DEBUG__?: {
      frames: number;
      lastKind: string;
      lastFrameMs: number;
      maxFrameMs: number;
      byKind: Record<string, { frames: number; lastFrameMs: number; maxFrameMs: number }>;
    };
  };
  const debug = target.__SVI_RENDER_DEBUG__ ?? {
    frames: 0,
    lastKind: kind,
    lastFrameMs: 0,
    maxFrameMs: 0,
    byKind: {},
  };
  const bucket = debug.byKind[kind] ?? { frames: 0, lastFrameMs: 0, maxFrameMs: 0 };
  bucket.frames += 1;
  bucket.lastFrameMs = Number(elapsedMs.toFixed(2));
  bucket.maxFrameMs = Math.max(bucket.maxFrameMs * 0.995, elapsedMs);
  debug.frames += 1;
  debug.lastKind = kind;
  debug.lastFrameMs = bucket.lastFrameMs;
  debug.maxFrameMs = Math.max(debug.maxFrameMs * 0.995, elapsedMs);
  debug.byKind[kind] = bucket;
  target.__SVI_RENDER_DEBUG__ = debug;
}

function interpolateCurveData(previous: CurveRow[], next: CurveRow[], t: number): CurveRow[] {
  if (next.length === 0) return [];
  const previousValid = previous.filter(
    (point): point is { x: number; y: number } => point.y != null && Number.isFinite(point.y)
  );
  if (previousValid.length === 0) {
    return next;
  }

  let rightIndex = 1;
  const lastIndex = previousValid.length - 1;

  return next.map((nextPoint) => {
    const nextY = nextPoint.y;
    if (nextY == null || !Number.isFinite(nextY)) {
      return nextPoint;
    }

    const targetX = nextPoint.x;
    let previousY: number;
    if (targetX <= previousValid[0].x) {
      previousY = previousValid[0].y;
    } else if (targetX >= previousValid[lastIndex].x) {
      previousY = previousValid[lastIndex].y;
    } else {
      while (rightIndex < previousValid.length && targetX > previousValid[rightIndex].x) {
        rightIndex += 1;
      }

      const right = previousValid[Math.min(rightIndex, lastIndex)];
      const left = previousValid[Math.max(0, rightIndex - 1)];
      const dx = right.x - left.x;
      if (!Number.isFinite(dx) || dx === 0) {
        previousY = left.y;
      } else {
        const ratio = (targetX - left.x) / dx;
        previousY = left.y + (right.y - left.y) * ratio;
      }
    }

    return {
      x: nextPoint.x,
      y: lerp(previousY, nextY, t),
    };
  });
}

function scatterMotionKey(point: ScatterRow): string {
  return `${point.exchange ?? "na"}:${point.side}:${point.strike}:${point.level}`;
}

function interpolateScatterData(previous: ScatterRow[], next: ScatterRow[], t: number): ScatterRow[] {
  if (next.length === 0) return [];
  if (previous.length === 0) return next;

  const previousByKey = new Map<string, ScatterRow>();
  for (const point of previous) {
    previousByKey.set(scatterMotionKey(point), point);
  }

  return next.map((nextPoint) => {
    const previousPoint = previousByKey.get(scatterMotionKey(nextPoint));
    if (!previousPoint) return nextPoint;

    const nextX = nextPoint.x;
    const nextY = nextPoint.y;
    const previousX = previousPoint.x;
    const previousY = previousPoint.y;

    if (
      !Number.isFinite(previousX) ||
      !Number.isFinite(previousY) ||
      !Number.isFinite(nextX) ||
      !Number.isFinite(nextY)
    ) {
      return nextPoint;
    }

    return {
      ...nextPoint,
      x: lerp(previousX, nextX, t),
      y: lerp(previousY, nextY, t),
    };
  });
}

function canAnimateCurveTransition(previous: CurveRow[], next: CurveRow[]): boolean {
  if (previous.length < 2 || next.length < 2) return false;
  if (Math.max(previous.length, next.length) > 320) return false;

  const lengthRatio = Math.max(previous.length, next.length) / Math.min(previous.length, next.length);
  if (!Number.isFinite(lengthRatio) || lengthRatio > 1.35) {
    return false;
  }

  const sampleCount = Math.min(10, previous.length, next.length);
  if (sampleCount < 3) return true;

  let compared = 0;
  let totalXDelta = 0;
  let totalYDelta = 0;

  for (let idx = 0; idx < sampleCount; idx += 1) {
    const prevIdx = Math.round((idx * (previous.length - 1)) / (sampleCount - 1));
    const nextIdx = Math.round((idx * (next.length - 1)) / (sampleCount - 1));
    const prevPoint = previous[prevIdx];
    const nextPoint = next[nextIdx];
    if (!prevPoint || !nextPoint) continue;
    if (prevPoint.y == null || nextPoint.y == null) continue;
    if (!Number.isFinite(prevPoint.y) || !Number.isFinite(nextPoint.y)) continue;

    compared += 1;
    totalXDelta += Math.abs(nextPoint.x - prevPoint.x);
    totalYDelta += Math.abs(nextPoint.y - prevPoint.y);
  }

  if (compared === 0) return false;

  const avgXDelta = totalXDelta / compared;
  const avgYDelta = totalYDelta / compared;
  return avgXDelta <= 0.32 && avgYDelta <= 30;
}

function drawGrid(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  margin: Margin,
  xTicks: number[],
  yTicks: number[],
  xScale: (x: number) => number,
  yScale: (y: number) => number
) {
  ctx.save();
  ctx.strokeStyle = "rgba(111, 129, 153, 0.34)";
  ctx.lineWidth = 1;
  ctx.setLineDash([1, 7]);

  for (const x of xTicks) {
    const px = xScale(x);
    ctx.beginPath();
    ctx.moveTo(px, margin.top);
    ctx.lineTo(px, height - margin.bottom);
    ctx.stroke();
  }

  for (const y of yTicks) {
    const py = yScale(y);
    ctx.beginPath();
    ctx.moveTo(margin.left, py);
    ctx.lineTo(width - margin.right, py);
    ctx.stroke();
  }

  ctx.restore();
}

function drawAxes(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  margin: Margin,
  xTicks: number[],
  yTicks: number[],
  xScale: (x: number) => number,
  yScale: (y: number) => number,
  xLabel: string,
  yLabel: string,
  xFormatter: (v: number) => string,
  yFormatter: (v: number) => string
) {
  ctx.save();

  const left = margin.left;
  const right = width - margin.right;
  const top = margin.top;
  const bottom = height - margin.bottom;

  ctx.strokeStyle = "rgba(146, 162, 185, 0.62)";
  ctx.lineWidth = 1;
  ctx.setLineDash([]);

  ctx.beginPath();
  ctx.moveTo(left, bottom);
  ctx.lineTo(right, bottom);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(left, top);
  ctx.lineTo(left, bottom);
  ctx.stroke();

  ctx.fillStyle = "#9fb2cb";
  ctx.font = '11px "IBM Plex Sans", system-ui, sans-serif';
  ctx.textAlign = "center";
  ctx.textBaseline = "top";

  const xTickLabels = xTicks.map((x) => {
    const text = xFormatter(x);
    const width = ctx.measureText(text).width;
    return { x, text, width };
  });
  const maxXLabelCount = Math.max(2, Math.floor((right - left) / 82));
  const labelStep = Math.max(1, Math.ceil(xTickLabels.length / maxXLabelCount));
  let lastLabelRight = Number.NEGATIVE_INFINITY;

  for (let idx = 0; idx < xTickLabels.length; idx += 1) {
    const { x, text, width: textWidth } = xTickLabels[idx];
    const px = xScale(x);
    ctx.beginPath();
    ctx.moveTo(px, bottom);
    ctx.lineTo(px, bottom + 4);
    ctx.stroke();

    const shouldTryLabel =
      idx === 0 ||
      idx === xTickLabels.length - 1 ||
      idx % labelStep === 0;
    if (!shouldTryLabel) continue;

    const labelLeft = px - textWidth / 2;
    const labelRight = px + textWidth / 2;
    if (labelLeft <= lastLabelRight + 8 && idx !== xTickLabels.length - 1) continue;

    ctx.fillText(text, px, bottom + 8);
    lastLabelRight = labelRight;
  }

  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (const y of yTicks) {
    const py = yScale(y);
    ctx.beginPath();
    ctx.moveTo(left - 4, py);
    ctx.lineTo(left, py);
    ctx.stroke();
    ctx.fillText(yFormatter(y), left - 8, py);
  }

  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  ctx.fillText(xLabel, (left + right) / 2, height - 2);

  ctx.save();
  ctx.translate(12, (top + bottom) / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillText(yLabel, 0, 0);
  ctx.restore();

  ctx.restore();
}

function drawLineSeries(
  ctx: CanvasRenderingContext2D,
  data: CurveRow[],
  xScale: (x: number) => number,
  yScale: (y: number) => number,
  color: string,
  width: number,
  alpha = 1,
  dash: number[] = [],
  options?: {
    shadowBlur?: number;
    shadowAlpha?: number;
  }
) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.globalAlpha = alpha;
  ctx.lineWidth = width;
  ctx.setLineDash(dash);
  const shadowBlur = options?.shadowBlur ?? 0;
  const shadowAlpha = options?.shadowAlpha ?? 0;
  ctx.shadowBlur = shadowBlur;
  ctx.shadowColor = shadowBlur > 0 ? hexToRgba(color, shadowAlpha) : "transparent";
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.beginPath();

  let started = false;
  for (const point of data) {
    if (point.y == null || !Number.isFinite(point.y)) {
      started = false;
      continue;
    }

    const px = xScale(point.x);
    const py = yScale(point.y);
    if (!started) {
      ctx.moveTo(px, py);
      started = true;
    } else {
      ctx.lineTo(px, py);
    }
  }

  ctx.stroke();
  ctx.restore();
}

function withPlotClip(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  margin: Margin,
  draw: () => void
) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(
    margin.left,
    margin.top,
    width - margin.left - margin.right,
    height - margin.top - margin.bottom
  );
  ctx.clip();
  draw();
  ctx.restore();
}

function drawVarianceExpiryLabels(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  margin: Margin,
  series: VarianceSeries[],
  xDomain: [number, number],
  xScale: (x: number) => number,
  yScale: (y: number) => number
) {
  const targetAnchorX = xDomain[0] + (xDomain[1] - xDomain[0]) * 0.82;
  const rawLabels = series
    .map((item) => {
      const visiblePoints = item.data.filter(
        (point): point is { x: number; y: number } =>
          point.y != null &&
          Number.isFinite(point.y) &&
          point.x >= xDomain[0] &&
          point.x <= xDomain[1]
      );
      if (visiblePoints.length === 0) return null;
      const endpoint = visiblePoints.reduce((best, candidate) => {
        if (!best) return candidate;
        return Math.abs(candidate.x - targetAnchorX) < Math.abs(best.x - targetAnchorX)
          ? candidate
          : best;
      }, visiblePoints[0]);
      return {
        label: item.label,
        color: item.color,
        anchorX: xScale(endpoint.x),
        anchorY: yScale(endpoint.y),
        y: yScale(endpoint.y),
      };
    })
    .filter(Boolean) as Array<{
    label: string;
    color: string;
    anchorX: number;
    anchorY: number;
    y: number;
  }>;

  if (rawLabels.length === 0) return;

  const minY = margin.top + 8;
  const maxY = height - margin.bottom - 8;
  const availableHeight = Math.max(1, maxY - minY);
  const dynamicGap = availableHeight / Math.max(2, rawLabels.length + 1);
  const minGap = Math.min(14, Math.max(9, dynamicGap * 0.78));
  const labels = [...rawLabels].sort((a, b) => a.y - b.y);

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

  const labelX = width - margin.right + 12;
  ctx.save();
  ctx.font = '10px "IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";

  for (const label of labels) {
    ctx.strokeStyle = hexToRgba(label.color, 0.75);
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 3]);
    ctx.beginPath();
    ctx.moveTo(Math.min(label.anchorX + 2, width - margin.right), label.anchorY);
    ctx.lineTo(labelX - 5, label.y);
    ctx.stroke();

    const textMetrics = ctx.measureText(label.label);
    const textWidth = Math.ceil(textMetrics.width);
    const labelHeight = 12;
    const labelY = label.y - labelHeight / 2;
    ctx.fillStyle = "rgba(10, 16, 25, 0.9)";
    ctx.fillRect(labelX - 2, labelY, textWidth + 4, labelHeight);

    ctx.fillStyle = hexToRgba(label.color, 0.95);
    ctx.fillText(label.label, labelX, label.y);
  }

  ctx.restore();
}

function drawScatterSeries(
  ctx: CanvasRenderingContext2D,
  data: ScatterRow[],
  xScale: (x: number) => number,
  yScale: (y: number) => number,
  maxSize: number,
  options?: {
    exchangeStroke?: string;
    shape?: "circle" | "diamond" | "triangle" | "square";
  }
) {
  ctx.save();
  const exchangeStroke = options?.exchangeStroke;
  const shape = options?.shape ?? "circle";

  for (const point of data) {
    const px = xScale(point.x);
    const py = yScale(point.y);
    const opacity = getOpacityFromSizeRelative(point.size, maxSize, 0.18, 0.4);
    const radius = getRadiusFromSizeRelative(point.size, maxSize, 1.4, 2.5);
    const sideFill = point.side === "bid" ? "#66b389" : "#d26f74";

    ctx.beginPath();
    ctx.fillStyle = hexToRgba(sideFill, opacity);
    const strokeBase = exchangeStroke ?? sideFill;
    ctx.strokeStyle = hexToRgba(strokeBase, 0.78);
    ctx.lineWidth = 1;
    ctx.shadowBlur = 0;
    if (shape === "triangle") {
      ctx.moveTo(px, py - radius);
      ctx.lineTo(px + radius * 0.88, py + radius * 0.72);
      ctx.lineTo(px - radius * 0.88, py + radius * 0.72);
      ctx.closePath();
    } else if (shape === "square") {
      ctx.rect(px - radius, py - radius, radius * 2, radius * 2);
    } else if (shape === "diamond") {
      ctx.moveTo(px, py - radius);
      ctx.lineTo(px + radius, py);
      ctx.lineTo(px, py + radius);
      ctx.lineTo(px - radius, py);
      ctx.closePath();
    } else {
      ctx.arc(px, py, radius, 0, Math.PI * 2);
    }
    ctx.fill();
    ctx.stroke();
  }

  ctx.restore();
}

function drawTradeScatterSeries(
  ctx: CanvasRenderingContext2D,
  data: ScatterRow[],
  xScale: (x: number) => number,
  yScale: (y: number) => number,
  color: string,
  nowMs: number
) {
  ctx.save();

  for (const point of data) {
    const tradeAgeMs =
      point.tradeUpdateTs != null
        ? Math.max(0, nowMs - point.tradeUpdateTs)
        : null;
    const fadeRatio =
      tradeAgeMs == null
        ? 1
        : Math.max(0, 1 - tradeAgeMs / TRADE_FADE_OUT_DURATION_MS);
    if (fadeRatio <= 0) continue;

    const px = xScale(point.x);
    const py = yScale(point.y);
    const isFlashing = point.flashUntilTs != null && nowMs < point.flashUntilTs;
    const flashPhase = isFlashing ? (1 - (point.flashUntilTs! - nowMs) / TRADE_FLASH_DURATION_MS) : 0;
    const pulse = isFlashing ? 0.5 + 0.5 * Math.sin(flashPhase * Math.PI * 8) : 0;
    const radius = isFlashing ? 3 + pulse * 0.6 : 2.8;
    const radiusWithFade = radius * Math.max(0.45, 0.6 + fadeRatio * 0.4);

    ctx.shadowBlur = 0;
    ctx.shadowColor = "transparent";
    ctx.beginPath();
    ctx.fillStyle = hexToRgba(color, (isFlashing ? 0.95 : 0.8) * fadeRatio);
    ctx.strokeStyle = `rgba(28, 18, 7, ${(isFlashing ? 0.72 : 0.58) * fadeRatio})`;
    ctx.lineWidth = (isFlashing ? 1.2 : 0.9) * Math.max(0.65, fadeRatio);
    ctx.arc(px, py, radiusWithFade, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  ctx.restore();
}

function drawReferenceLine(
  ctx: CanvasRenderingContext2D,
  x: number,
  margin: Margin,
  height: number,
  color: string,
  dash = [4, 4],
  alpha = 1
) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.globalAlpha = alpha;
  ctx.lineWidth = 1;
  ctx.setLineDash(dash);
  ctx.beginPath();
  ctx.moveTo(x, margin.top);
  ctx.lineTo(x, height - margin.bottom);
  ctx.stroke();
  ctx.restore();
}

function drawPlotBorder(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  margin: Margin
) {
  ctx.save();
  ctx.strokeStyle = "rgba(96, 112, 133, 0.62)";
  ctx.lineWidth = 1;
  ctx.strokeRect(
    margin.left,
    margin.top,
    width - margin.left - margin.right,
    height - margin.top - margin.bottom
  );
  ctx.restore();
}

function renderSmileChartFrame({
  ctx,
  width,
  height,
  margin,
  row,
  lineColor,
  hoverX,
  xLabel,
  scatterMode,
  showAxes,
  showReferenceLines,
  previousCurveData,
  xDomainOverride,
  yDomainOverride,
  xTicksOverride,
  yTicksOverride,
  nowMs,
}: {
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  margin: Margin;
  row: SmileChartRow;
  lineColor: string;
  hoverX: number | null;
  xLabel: string;
  scatterMode: "all" | "best";
  showAxes: boolean;
  showReferenceLines: boolean;
  previousCurveData?: CurveRow[] | null;
  xDomainOverride?: [number, number];
  yDomainOverride?: [number, number];
  xTicksOverride?: number[];
  yTicksOverride?: number[];
  nowMs?: number;
}) {
  ctx.clearRect(0, 0, width, height);

  const xDomain = xDomainOverride ?? row.xDomain;
  const yDomain = yDomainOverride ?? row.yDomain;
  const xTicks = xTicksOverride ?? row.xTicks;
  const yTicks = yTicksOverride ?? row.yTicks;

  const xScale = makeXScale(xDomain, width, margin);
  const yScale = makeYScale(yDomain, height, margin);
  const isStrikeAxis = xLabel.toLowerCase().includes("strike");

  if (showAxes) {
    drawGrid(ctx, width, height, margin, xTicks, yTicks, xScale, yScale);
  }

  if (showReferenceLines && row.atmX != null) {
    if (isStrikeAxis) {
      drawReferenceLine(ctx, xScale(row.atmX), margin, height, "#ffb35a", [6, 3], 0.95);
    } else {
      drawReferenceLine(ctx, xScale(row.atmX - 0.02), margin, height, "#344055", [2, 4], 0.85);
      drawReferenceLine(ctx, xScale(row.atmX), margin, height, "#a7b4c8", [4, 3], 0.68);
      drawReferenceLine(ctx, xScale(row.atmX + 0.02), margin, height, "#344055", [2, 4], 0.85);
    }
  }

  const askScatter = scatterMode === "best" ? row.bestAskScatter : row.askScatter;
  const bidScatter = scatterMode === "best" ? row.bestBidScatter : row.bidScatter;
  const rowOkxScatter = row.okxScatter ?? [];
  const okxScatter = scatterMode === "best"
    ? rowOkxScatter.filter((point) => point.level === 0)
    : rowOkxScatter;
  const tradeScatter = row.lastTradeScatter;

  if (previousCurveData && previousCurveData.length > 0) {
    drawLineSeries(ctx, previousCurveData, xScale, yScale, "#8ea0b8", 1.2, 0.52, [4, 4]);
  }

  drawLineSeries(ctx, row.curveData, xScale, yScale, lineColor, 2.4, 0.26);
  drawLineSeries(ctx, row.curveData, xScale, yScale, lineColor, 1.6, 0.98);
  drawScatterSeries(ctx, askScatter, xScale, yScale, row.maxVisibleSize, {
    shape: "circle",
  });
  drawScatterSeries(ctx, bidScatter, xScale, yScale, row.maxVisibleSize, {
    shape: "circle",
  });
  drawScatterSeries(ctx, okxScatter, xScale, yScale, row.maxVisibleSize, {
    shape: "square",
  });
  drawTradeScatterSeries(ctx, tradeScatter, xScale, yScale, "#ff9f2a", nowMs ?? Date.now());

  if (showReferenceLines && hoverX != null) {
    drawReferenceLine(ctx, xScale(hoverX), margin, height, "#8ea0b8", [3, 5], 0.64);
  }

  if (showAxes) {
    drawAxes(
      ctx,
      width,
      height,
      margin,
      xTicks,
      yTicks,
      xScale,
      yScale,
      xLabel,
      "vol",
      (value) => (isStrikeAxis ? STRIKE_TICK_FORMATTER.format(value) : value.toFixed(2)),
      (value) => value.toFixed(0)
    );

    drawPlotBorder(ctx, width, height, margin);
  }
}

export function VarianceCanvasChart({
  height,
  xLabel,
  yLabel = "variance",
  series,
  xDomain,
  yDomain,
  xTicks,
  yTicks,
  hoverX,
  onHoverX,
  onActivate,
  xTickFormatter = (value: number) => value.toFixed(2),
  yTickFormatter = (value: number) => value.toFixed(3),
}: {
  height: number;
  xLabel: string;
  yLabel?: string;
  series: VarianceSeries[];
  xDomain: [number, number];
  yDomain: [number, number];
  xTicks: number[];
  yTicks: number[];
  hoverX: number | null;
  onHoverX: (x: number | null) => void;
  onActivate?: () => void;
  xTickFormatter?: (value: number) => string;
  yTickFormatter?: (value: number) => string;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const width = useContainerWidth(wrapRef);
  const isVisible = useElementVisible(wrapRef);
  const margin = useMemo(
    () =>
      width <= 640
        ? { top: 10, right: 72, bottom: 34, left: 42 }
        : { top: 12, right: 118, bottom: 42, left: 52 },
    [width]
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || width <= 0 || !isVisible) return;
    const startedAt = performance.now();

    const ctx = dprSize(canvas, width, height);
    if (!ctx) return;

    ctx.clearRect(0, 0, width, height);

    const xScale = makeXScale(xDomain, width, margin);
    const yScale = makeYScale(yDomain, height, margin);

    drawGrid(ctx, width, height, margin, xTicks, yTicks, xScale, yScale);
    withPlotClip(ctx, width, height, margin, () => {
      for (const item of series) {
        drawLineSeries(ctx, item.data, xScale, yScale, item.color, 2, 0.98, [], {
          shadowBlur: 0,
          shadowAlpha: 0,
        });
      }
    });

    drawVarianceExpiryLabels(ctx, width, height, margin, series, xDomain, xScale, yScale);

    if (hoverX != null) {
      drawReferenceLine(ctx, xScale(hoverX), margin, height, "#8ea0b8", [3, 5], 0.62);
    }

    drawAxes(
      ctx,
      width,
      height,
      margin,
      xTicks,
      yTicks,
      xScale,
      yScale,
      xLabel,
      yLabel,
      xTickFormatter,
      yTickFormatter
    );

    drawPlotBorder(ctx, width, height, margin);
    recordCanvasFrame("variance", startedAt);
  }, [height, hoverX, isVisible, margin, series, width, xDomain, xLabel, xTickFormatter, xTicks, yDomain, yLabel, yTickFormatter, yTicks]);

  const handleMove = useCallback(
    (event: MouseEvent<HTMLCanvasElement>) => {
      if (!wrapRef.current) return;
      const rect = wrapRef.current.getBoundingClientRect();
      onHoverX(invertX(event.clientX - rect.left, xDomain, width, margin));
    },
    [margin, onHoverX, width, xDomain]
  );

  return (
    <div ref={wrapRef} className="chart-frame" style={{ width: "100%", height, minWidth: 0 }}>
      <canvas
        ref={canvasRef}
        onMouseMove={handleMove}
        onMouseLeave={() => onHoverX(null)}
        onClick={onActivate}
        style={{ width: "100%", height: "100%", display: "block", cursor: "crosshair" }}
      />
    </div>
  );
}

export function SmileCanvasChart({
  height,
  xLabel,
  row,
  lineColor,
  hoverX,
  onHoverX,
  scatterMode = "all",
  showAxes = true,
  showReferenceLines = true,
}: {
  height: number;
  xLabel: string;
  row: SmileChartRow;
  lineColor: string;
  hoverX: number | null;
  onHoverX: (x: number | null) => void;
  scatterMode?: "all" | "best";
  showAxes?: boolean;
  showReferenceLines?: boolean;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const previousRowRef = useRef<SmileChartRow | null>(null);
  const previousCurveGhostRef = useRef<CurveRow[] | null>(null);
  const previousXAxisLabelRef = useRef<string | null>(null);
  const lastAnimationStartRef = useRef(0);
  const width = useContainerWidth(wrapRef);
  const isVisible = useElementVisible(wrapRef);
  const margin = useMemo(
    () =>
      width <= 640
        ? { top: 10, right: 8, bottom: 34, left: 40 }
        : { top: 12, right: 12, bottom: 42, left: 48 },
    [width]
  );
  const tradeMotionNowMs = useTradeMotionNow(row.lastTradeScatter, isVisible);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || width <= 0 || !isVisible) return;

    const ctx = dprSize(canvas, width, height);
    if (!ctx) return;

    const previousXAxisLabel = previousXAxisLabelRef.current;
    const axisModeChanged = previousXAxisLabel != null && previousXAxisLabel !== xLabel;
    if (axisModeChanged) {
      previousRowRef.current = null;
      previousCurveGhostRef.current = null;
    }
    previousXAxisLabelRef.current = xLabel;

    const previousRow = previousRowRef.current;
    const nowPerf = performance.now();
    const isBurstUpdate = nowPerf - lastAnimationStartRef.current < 120;
    const animatedScatterCount =
      row.bidScatter.length +
      row.askScatter.length +
      (row.okxScatter?.length ?? 0) +
      row.lastTradeScatter.length;
    const shouldAnimate =
      previousRow != null &&
      previousRow.expiry === row.expiry &&
      width > 640 &&
      showAxes &&
      scatterMode === "all" &&
      !isBurstUpdate &&
      animatedScatterCount <= MAX_ANIMATED_SCATTER_POINTS &&
      canAnimateCurveTransition(previousRow.curveData, row.curveData);

    if (!shouldAnimate) {
      const startedAt = performance.now();
      if (
        previousRow &&
        previousRow.expiry === row.expiry &&
        showAxes &&
        scatterMode === "all" &&
        previousRow.curveData !== row.curveData
      ) {
        previousCurveGhostRef.current = previousRow.curveData;
      }

      renderSmileChartFrame({
        ctx,
        width,
        height,
        margin,
        row,
        lineColor,
        hoverX,
        xLabel,
        scatterMode,
        showAxes,
        showReferenceLines,
        previousCurveData: previousCurveGhostRef.current,
        nowMs: tradeMotionNowMs,
      });
      previousRowRef.current = row;
      recordCanvasFrame("smile", startedAt);
      return;
    }

    const fromRow = previousRow;
    previousRowRef.current = row;
    lastAnimationStartRef.current = nowPerf;
    const animationDurationMs = 260;
    let frameId = 0;
    const startedAt = nowPerf;

    const renderAnimatedFrame = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / animationDurationMs);
      const eased = easeOutCubic(progress);
      const interpolatedRow: SmileChartRow = {
        ...row,
        curveData: interpolateCurveData(fromRow.curveData, row.curveData, eased),
        bidScatter: interpolateScatterData(fromRow.bidScatter, row.bidScatter, eased),
        askScatter: interpolateScatterData(fromRow.askScatter, row.askScatter, eased),
        okxScatter: interpolateScatterData(fromRow.okxScatter ?? [], row.okxScatter ?? [], eased),
        bestBidScatter: interpolateScatterData(fromRow.bestBidScatter, row.bestBidScatter, eased),
        bestAskScatter: interpolateScatterData(fromRow.bestAskScatter, row.bestAskScatter, eased),
        lastTradeScatter: interpolateScatterData(fromRow.lastTradeScatter, row.lastTradeScatter, eased),
      };

      const frameStartedAt = performance.now();
      renderSmileChartFrame({
        ctx,
        width,
        height,
        margin,
        row: interpolatedRow,
        lineColor,
        hoverX,
        xLabel,
        scatterMode,
        showAxes,
        showReferenceLines,
        previousCurveData: previousCurveGhostRef.current,
        xDomainOverride: row.xDomain,
        yDomainOverride: row.yDomain,
        xTicksOverride: row.xTicks,
        yTicksOverride: row.yTicks,
        nowMs: tradeMotionNowMs || Date.now(),
      });
      recordCanvasFrame("smile-animation", frameStartedAt);

      if (progress < 1) {
        frameId = requestAnimationFrame(renderAnimatedFrame);
      } else {
        previousCurveGhostRef.current = fromRow.curveData;
      }
    };

    frameId = requestAnimationFrame(renderAnimatedFrame);
    return () => cancelAnimationFrame(frameId);
  }, [
    height,
    hoverX,
    isVisible,
    lineColor,
    margin,
    row,
    scatterMode,
    showAxes,
    showReferenceLines,
    tradeMotionNowMs,
    width,
    xLabel,
  ]);

  const handleMove = useCallback(
    (event: MouseEvent<HTMLCanvasElement>) => {
      if (!wrapRef.current) return;
      const rect = wrapRef.current.getBoundingClientRect();
      onHoverX(invertX(event.clientX - rect.left, row.xDomain, width, margin));
    },
    [margin, onHoverX, row.xDomain, width]
  );

  return (
    <div ref={wrapRef} className="chart-frame" style={{ width: "100%", height, minWidth: 0 }}>
      <canvas
        ref={canvasRef}
        onMouseMove={handleMove}
        onMouseLeave={() => onHoverX(null)}
        style={{ width: "100%", height: "100%", display: "block", cursor: "crosshair" }}
      />
    </div>
  );
}

export function MiniSmileCanvasChart({
  row,
  lineColor,
}: {
  row: SmileChartRow;
  lineColor: string;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const width = useContainerWidth(wrapRef);
  const height = 72;
  const margin = useMemo(() => ({ top: 8, right: 8, bottom: 8, left: 8 }), []);
  const isVisible = useElementVisible(wrapRef);
  const tradeMotionNowMs = useTradeMotionNow(row.lastTradeScatter, isVisible);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || width <= 0 || !isVisible) return;
    const startedAt = performance.now();

    const ctx = dprSize(canvas, width, height);
    if (!ctx) return;

    ctx.save();
    ctx.fillStyle = "#0d141d";
    ctx.fillRect(0, 0, width, height);
    ctx.restore();

    renderSmileChartFrame({
      ctx,
      width,
      height,
      margin,
      row,
      lineColor,
      hoverX: null,
      xLabel: "",
      scatterMode: "best",
      showAxes: false,
      showReferenceLines: false,
      nowMs: tradeMotionNowMs,
    });
    recordCanvasFrame("mini-smile", startedAt);
  }, [height, isVisible, lineColor, margin, row, tradeMotionNowMs, width]);

  return (
    <div ref={wrapRef} className="mini-chart-frame">
      <canvas
        ref={canvasRef}
        style={{ width: "100%", height: "100%", display: "block" }}
      />
    </div>
  );
}
