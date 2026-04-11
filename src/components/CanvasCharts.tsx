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
  ctx.strokeStyle = "#e2e8f0";
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 3]);

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

  ctx.strokeStyle = "#cbd5e1";
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

  ctx.fillStyle = "#64748b";
  ctx.font = "11px system-ui, -apple-system, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";

  for (const x of xTicks) {
    const px = xScale(x);
    ctx.beginPath();
    ctx.moveTo(px, bottom);
    ctx.lineTo(px, bottom + 4);
    ctx.stroke();
    ctx.fillText(xFormatter(x), px, bottom + 8);
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
  alpha = 1
) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.globalAlpha = alpha;
  ctx.lineWidth = width;
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
    const opacity = getOpacityFromSizeRelative(point.size, maxSize, 0.12, 0.72);
    const radius = getRadiusFromSizeRelative(point.size, maxSize, 1.8, 3.2);

    ctx.beginPath();
    ctx.fillStyle = hexToRgba(color, opacity);
    ctx.arc(px, py, radius, 0, Math.PI * 2);
    ctx.fill();
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
  ctx.strokeStyle = "#e2e8f0";
  ctx.lineWidth = 1;
  ctx.strokeRect(
    margin.left,
    margin.top,
    width - margin.left - margin.right,
    height - margin.top - margin.bottom
  );
  ctx.restore();
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
  const margin = { top: 12, right: 18, bottom: 42, left: 52 };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || width <= 0) return;

    const ctx = dprSize(canvas, width, height);
    if (!ctx) return;

    ctx.clearRect(0, 0, width, height);

    const xScale = makeXScale(xDomain, width, margin);
    const yScale = makeYScale(yDomain, height, margin);

    drawGrid(ctx, width, height, margin, xTicks, yTicks, xScale, yScale);
    for (const item of series) {
      drawLineSeries(ctx, item.data, xScale, yScale, item.color, 2.2, 1);
    }

    if (hoverX != null) {
      drawReferenceLine(ctx, xScale(hoverX), margin, height, "#94a3b8", [4, 4], 1);
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
      (value) => value.toFixed(4)
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
    <div ref={wrapRef} style={{ width: "100%", height, minWidth: 0 }}>
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
}: {
  height: number;
  xLabel: string;
  row: SmileChartRow;
  lineColor: string;
  hoverX: number | null;
  onHoverX: (x: number | null) => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const width = useContainerWidth(wrapRef);
  const margin = { top: 12, right: 12, bottom: 42, left: 48 };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || width <= 0) return;

    const ctx = dprSize(canvas, width, height);
    if (!ctx) return;

    ctx.clearRect(0, 0, width, height);

    const xScale = makeXScale(row.xDomain, width, margin);
    const yScale = makeYScale(row.yDomain, height, margin);

    drawGrid(ctx, width, height, margin, row.xTicks, row.yTicks, xScale, yScale);

    if (row.atmX != null) {
      drawReferenceLine(ctx, xScale(row.atmX - 0.02), margin, height, "#e2e8f0", [2, 4], 1);
      drawReferenceLine(ctx, xScale(row.atmX), margin, height, "#cbd5e1", [3, 3], 1);
      drawReferenceLine(ctx, xScale(row.atmX + 0.02), margin, height, "#e2e8f0", [2, 4], 1);
    }

    drawLineSeries(ctx, row.curveData, xScale, yScale, lineColor, 6, 0.12);
    drawLineSeries(ctx, row.curveData, xScale, yScale, lineColor, 2.8, 1);
    drawScatterSeries(ctx, row.askScatter, xScale, yScale, "#dc2626", row.maxVisibleSize);
    drawScatterSeries(ctx, row.bidScatter, xScale, yScale, "#16a34a", row.maxVisibleSize);

    if (hoverX != null) {
      drawReferenceLine(ctx, xScale(hoverX), margin, height, "#94a3b8", [4, 4], 1);
    }

    drawAxes(
      ctx,
      width,
      height,
      margin,
      row.xTicks,
      row.yTicks,
      xScale,
      yScale,
      xLabel,
      "vol",
      (value) => value.toFixed(2),
      (value) => value.toFixed(0)
    );

    drawPlotBorder(ctx, width, height, margin);
  }, [height, hoverX, lineColor, row, width, xLabel]);

  const handleMove = useCallback(
    (event: MouseEvent<HTMLCanvasElement>) => {
      if (!wrapRef.current) return;
      const rect = wrapRef.current.getBoundingClientRect();
      onHoverX(invertX(event.clientX - rect.left, row.xDomain, width, margin));
    },
    [onHoverX, row.xDomain, width]
  );

  return (
    <div ref={wrapRef} style={{ width: "100%", height, minWidth: 0 }}>
      <canvas
        ref={canvasRef}
        onMouseMove={handleMove}
        onMouseLeave={() => onHoverX(null)}
        style={{ width: "100%", height: "100%", display: "block", cursor: "crosshair" }}
      />
    </div>
  );
}
