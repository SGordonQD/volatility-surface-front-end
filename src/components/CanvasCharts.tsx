import { useCallback, useEffect, useRef, useState, type MouseEvent, type RefObject } from "react";

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
const STRIKE_TICK_FORMATTER = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 0 });

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
  return `${point.side}:${point.strike}:${point.level}`;
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
      const endpoint = visiblePoints[visiblePoints.length - 1];
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
  const minGap = 12;
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

  const labelX = width - margin.right + 10;
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
  color: string,
  maxSize: number
) {
  ctx.save();

  for (const point of data) {
    const px = xScale(point.x);
    const py = yScale(point.y);
    const opacity = getOpacityFromSizeRelative(point.size, maxSize, 0.18, 0.4);
    const radius = getRadiusFromSizeRelative(point.size, maxSize, 1.4, 2.5);

    ctx.beginPath();
    ctx.fillStyle = hexToRgba(color, opacity);
    ctx.strokeStyle = hexToRgba(color, 0.78);
    ctx.lineWidth = 1;
    ctx.shadowBlur = 0;
    ctx.arc(px, py, radius, 0, Math.PI * 2);
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
  const tradeScatter = row.lastTradeScatter;

  if (previousCurveData && previousCurveData.length > 0) {
    drawLineSeries(ctx, previousCurveData, xScale, yScale, "#8ea0b8", 1.2, 0.52, [4, 4]);
  }

  drawLineSeries(ctx, row.curveData, xScale, yScale, lineColor, 2.4, 0.26);
  drawLineSeries(ctx, row.curveData, xScale, yScale, lineColor, 1.6, 0.98);
  drawScatterSeries(ctx, askScatter, xScale, yScale, "#d26f74", row.maxVisibleSize);
  drawScatterSeries(ctx, bidScatter, xScale, yScale, "#66b389", row.maxVisibleSize);
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
  series,
  xDomain,
  yDomain,
  xTicks,
  yTicks,
  hoverX,
  onHoverX,
}: {
  height: number;
  xLabel: string;
  series: VarianceSeries[];
  xDomain: [number, number];
  yDomain: [number, number];
  xTicks: number[];
  yTicks: number[];
  hoverX: number | null;
  onHoverX: (x: number | null) => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const width = useContainerWidth(wrapRef);
  const margin = { top: 12, right: 92, bottom: 42, left: 52 };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || width <= 0) return;

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
      "variance",
      (value) => value.toFixed(2),
      (value) => value.toFixed(3)
    );

    drawPlotBorder(ctx, width, height, margin);
  }, [height, hoverX, series, width, xDomain, xLabel, xTicks, yDomain, yTicks]);

  const handleMove = useCallback(
    (event: MouseEvent<HTMLCanvasElement>) => {
      if (!wrapRef.current) return;
      const rect = wrapRef.current.getBoundingClientRect();
      onHoverX(invertX(event.clientX - rect.left, xDomain, width, margin));
    },
    [onHoverX, width, xDomain]
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
  const lastAnimationStartRef = useRef(0);
  const [tradeFlashTick, setTradeFlashTick] = useState(0);
  const width = useContainerWidth(wrapRef);
  const margin = { top: 12, right: 12, bottom: 42, left: 48 };

  useEffect(() => {
    const nowMs = Date.now();
    const hasActiveTradeMotion = row.lastTradeScatter.some(
      (point) =>
        (point.flashUntilTs != null && point.flashUntilTs > nowMs) ||
        (point.tradeUpdateTs != null && nowMs - point.tradeUpdateTs < TRADE_FADE_OUT_DURATION_MS)
    );
    if (!hasActiveTradeMotion) return;

    const intervalId = window.setInterval(() => {
      setTradeFlashTick((previous) => previous + 1);
    }, 120);

    return () => window.clearInterval(intervalId);
  }, [row.lastTradeScatter]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || width <= 0) return;

    const ctx = dprSize(canvas, width, height);
    if (!ctx) return;

    const previousRow = previousRowRef.current;
    const nowPerf = performance.now();
    const isBurstUpdate = nowPerf - lastAnimationStartRef.current < 120;
    const shouldAnimate =
      previousRow != null &&
      previousRow.expiry === row.expiry &&
      showAxes &&
      scatterMode === "all" &&
      !isBurstUpdate &&
      canAnimateCurveTransition(previousRow.curveData, row.curveData);

    if (!shouldAnimate) {
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
        nowMs: Date.now(),
      });
      previousRowRef.current = row;
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
        bestBidScatter: interpolateScatterData(fromRow.bestBidScatter, row.bestBidScatter, eased),
        bestAskScatter: interpolateScatterData(fromRow.bestAskScatter, row.bestAskScatter, eased),
      };

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
        nowMs: Date.now(),
      });

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
    lineColor,
    row,
    scatterMode,
    showAxes,
    showReferenceLines,
    tradeFlashTick,
    width,
    xLabel,
  ]);

  const handleMove = useCallback(
    (event: MouseEvent<HTMLCanvasElement>) => {
      if (!wrapRef.current) return;
      const rect = wrapRef.current.getBoundingClientRect();
      onHoverX(invertX(event.clientX - rect.left, row.xDomain, width, margin));
    },
    [onHoverX, row.xDomain, width]
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
  const [tradeFlashTick, setTradeFlashTick] = useState(0);
  const width = useContainerWidth(wrapRef);
  const height = 72;
  const margin = { top: 8, right: 8, bottom: 8, left: 8 };

  useEffect(() => {
    const nowMs = Date.now();
    const hasActiveTradeMotion = row.lastTradeScatter.some(
      (point) =>
        (point.flashUntilTs != null && point.flashUntilTs > nowMs) ||
        (point.tradeUpdateTs != null && nowMs - point.tradeUpdateTs < TRADE_FADE_OUT_DURATION_MS)
    );
    if (!hasActiveTradeMotion) return;

    const intervalId = window.setInterval(() => {
      setTradeFlashTick((previous) => previous + 1);
    }, 160);

    return () => window.clearInterval(intervalId);
  }, [row.lastTradeScatter]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || width <= 0) return;

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
      nowMs: Date.now(),
    });
  }, [height, lineColor, row, tradeFlashTick, width]);

  return (
    <div ref={wrapRef} className="mini-chart-frame">
      <canvas
        ref={canvasRef}
        style={{ width: "100%", height: "100%", display: "block" }}
      />
    </div>
  );
}
