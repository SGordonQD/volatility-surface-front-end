import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  type WheelEvent as ReactWheelEvent,
} from "react";

import type { SviSurfaceGrid } from "../lib/svi-types";

const DEFAULT_CAMERA = {
  azimuth: -0.88,
  elevation: 0.56,
  zoom: 1.06,
} as const;

const WORLD_BOUNDS = {
  xMin: -1.48,
  xMax: 1.18,
  yMin: -1.16,
  yMax: 1.28,
  zMin: -1.08,
  zMax: 1.18,
} as const;

const SURFACE_PALETTE = [
  { stop: 0.0, rgb: [106, 30, 208] as const },
  { stop: 0.14, rgb: [78, 58, 238] as const },
  { stop: 0.3, rgb: [60, 129, 234] as const },
  { stop: 0.48, rgb: [77, 211, 226] as const },
  { stop: 0.64, rgb: [140, 234, 190] as const },
  { stop: 0.8, rgb: [246, 210, 121] as const },
  { stop: 0.92, rgb: [244, 130, 71] as const },
  { stop: 1.0, rgb: [239, 54, 43] as const },
] as const;

type PaletteStop = (typeof SURFACE_PALETTE)[number];

type SurfaceMode = "vol" | "var";

type Surface3DCanvasProps = {
  grid: SviSurfaceGrid | null;
  height: number;
  mode: SurfaceMode;
  onActivate?: () => void;
};

type CameraState = {
  azimuth: number;
  elevation: number;
  zoom: number;
};

type PreparedPoint = {
  x: number;
  y: number;
  z: number;
  strike: number;
  day: number;
  value: number | null;
};

type PreparedRow = {
  expiry: number;
  label?: string;
  atm: number | null;
  day: number;
  points: PreparedPoint[];
};

type PreparedSurface = {
  rows: PreparedRow[];
  ranges: {
    strikeMin: number;
    strikeMax: number;
    dayMin: number;
    dayMax: number;
    valueMin: number;
    valueMax: number;
  };
  ticks: {
    strike: number[];
    day: number[];
    value: number[];
  };
  useStrikeAxis: boolean;
  zLabel: string;
};

type ViewPoint = {
  x: number;
  y: number;
  z: number;
  sx: number;
  sy: number;
};

type DragState = {
  pointerId: number;
  startX: number;
  startY: number;
  azimuth: number;
  elevation: number;
  moved: boolean;
};

function useContainerWidth(ref: RefObject<HTMLDivElement | null>) {
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const observer = new ResizeObserver((entries) => {
      const nextWidth = entries[0]?.contentRect.width ?? 0;
      setWidth(nextWidth);
    });

    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);

  return width;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function lerp(start: number, end: number, t: number) {
  return start + ((end - start) * t);
}

function safeNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalize(value: number, min: number, max: number) {
  if (!Number.isFinite(value) || !Number.isFinite(min) || !Number.isFinite(max) || Math.abs(max - min) <= 1e-9) {
    return 0.5;
  }
  return clamp((value - min) / (max - min), 0, 1);
}

function buildTicks(min: number, max: number, count: number) {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [];
  if (Math.abs(max - min) <= 1e-9) return [min];
  const step = (max - min) / Math.max(1, count - 1);
  return Array.from({ length: count }, (_, index) => min + (index * step));
}

function formatTick(value: number, compact = false) {
  if (!Number.isFinite(value)) return "—";
  if (compact && Math.abs(value) >= 1000) {
    return new Intl.NumberFormat("en-GB", {
      maximumFractionDigits: 1,
      notation: "compact",
    }).format(value);
  }
  if (Math.abs(value) >= 100) return value.toFixed(0);
  if (Math.abs(value) >= 10) return value.toFixed(1);
  if (Math.abs(value) >= 1) return value.toFixed(2);
  return value.toFixed(3);
}

function pickSpreadIndices(length: number, targetCount: number) {
  if (length <= 0) return [];
  if (length <= targetCount) return Array.from({ length }, (_, index) => index);
  const step = (length - 1) / Math.max(1, targetCount - 1);
  const indices: number[] = [];
  for (let index = 0; index < targetCount; index += 1) {
    indices.push(Math.round(index * step));
  }
  return [...new Set(indices)];
}

function interpolatePalette(t: number, alpha = 1) {
  const normalized = clamp(t, 0, 1);
  let left: PaletteStop = SURFACE_PALETTE[0];
  let right: PaletteStop = SURFACE_PALETTE[SURFACE_PALETTE.length - 1];

  for (let index = 1; index < SURFACE_PALETTE.length; index += 1) {
    const stop = SURFACE_PALETTE[index];
    if (normalized <= stop.stop) {
      right = stop;
      left = SURFACE_PALETTE[index - 1];
      break;
    }
  }

  const span = Math.max(1e-9, right.stop - left.stop);
  const mix = clamp((normalized - left.stop) / span, 0, 1);
  const rgb = left.rgb.map((channel, index) => Math.round(lerp(channel, right.rgb[index], mix)));
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`;
}

function toGradientCss() {
  return `linear-gradient(to top, ${SURFACE_PALETTE.map((stop) => `${interpolatePalette(stop.stop)} ${Math.round(stop.stop * 100)}%`).join(", ")})`;
}

function prepareSurface(grid: SviSurfaceGrid | null, mode: SurfaceMode): PreparedSurface | null {
  if (!grid || !Array.isArray(grid.x_values) || grid.x_values.length === 0) return null;

  const sortedRows = [...(grid.rows ?? [])].sort((left, right) => left.expiry - right.expiry);
  if (sortedRows.length === 0) return null;

  const rawDays = sortedRows
    .map((row) => safeNumber(row.days))
    .filter((value): value is number => value != null && value > 0);
  const treatDaysAsYears = rawDays.length > 0 && Math.max(...rawDays) <= 5;

  const useStrikeAxis = sortedRows.some((row) => {
    const atm = safeNumber(row.atm);
    return atm != null && atm > 0;
  });

  const rows: PreparedRow[] = sortedRows.map((row, rowIndex) => {
    const atm = safeNumber(row.atm);
    const rawDay = safeNumber(row.days);
    const day =
      rawDay != null && rawDay > 0
        ? treatDaysAsYears
          ? rawDay * 365
          : rawDay
        : rowIndex + 1;
    const sourceSeries = mode === "vol" ? row.vol : row.var;

    const points = grid.x_values.map((xValue, columnIndex) => {
      const x = safeNumber(xValue) ?? 0;
      const strike = useStrikeAxis && atm != null && atm > 0 ? atm * Math.exp(x) : x;
      return {
        x: 0,
        y: 0,
        z: 0,
        strike,
        day,
        value: safeNumber(sourceSeries?.[columnIndex]),
      };
    });

    return {
      expiry: row.expiry,
      label: row.label,
      atm,
      day,
      points,
    };
  });

  const strikeValues = rows.flatMap((row) => row.points.map((point) => point.strike));
  const dayValues = rows.map((row) => row.day);
  const valueValues = rows.flatMap((row) =>
    row.points
      .map((point) => point.value)
      .filter((value): value is number => value != null && Number.isFinite(value))
  );

  if (strikeValues.length === 0 || dayValues.length === 0 || valueValues.length === 0) {
    return null;
  }

  let strikeMin = Math.min(...strikeValues);
  let strikeMax = Math.max(...strikeValues);
  let dayMin = Math.min(...dayValues);
  let dayMax = Math.max(...dayValues);
  let valueMin = Math.min(...valueValues);
  let valueMax = Math.max(...valueValues);

  if (Math.abs(strikeMax - strikeMin) <= 1e-9) {
    strikeMin -= 1;
    strikeMax += 1;
  }
  if (Math.abs(dayMax - dayMin) <= 1e-9) {
    dayMin -= 1;
    dayMax += 1;
  }
  if (Math.abs(valueMax - valueMin) <= 1e-9) {
    valueMin -= 1;
    valueMax += 1;
  }

  const valuePad = (valueMax - valueMin) * 0.08;
  valueMin -= valuePad;
  valueMax += valuePad;

  const preparedRows = rows.map((row) => ({
    ...row,
    points: row.points.map((point) => ({
      ...point,
      x: lerp(WORLD_BOUNDS.xMin, WORLD_BOUNDS.xMax, normalize(point.strike, strikeMin, strikeMax)),
      y: lerp(WORLD_BOUNDS.yMin, WORLD_BOUNDS.yMax, normalize(point.value ?? valueMin, valueMin, valueMax)),
      z: lerp(WORLD_BOUNDS.zMin, WORLD_BOUNDS.zMax, normalize(point.day, dayMin, dayMax)),
    })),
  }));

  return {
    rows: preparedRows,
    ranges: { strikeMin, strikeMax, dayMin, dayMax, valueMin, valueMax },
    ticks: {
      strike: buildTicks(strikeMin, strikeMax, useStrikeAxis ? 5 : 6),
      day: buildTicks(dayMin, dayMax, 5),
      value: buildTicks(valueMin, valueMax, 6),
    },
    useStrikeAxis,
    zLabel: mode === "vol" ? "Implied Vol (%)" : "Total Variance",
  };
}

function projectPoint(
  point: { x: number; y: number; z: number },
  camera: CameraState,
  width: number,
  height: number
): ViewPoint {
  const cosA = Math.cos(camera.azimuth);
  const sinA = Math.sin(camera.azimuth);
  const cosE = Math.cos(camera.elevation);
  const sinE = Math.sin(camera.elevation);

  const rotatedX = (point.x * cosA) - (point.z * sinA);
  const rotatedZ = (point.x * sinA) + (point.z * cosA);

  const elevatedY = (point.y * cosE) - (rotatedZ * sinE);
  const elevatedZ = (point.y * sinE) + (rotatedZ * cosE);

  const cameraDistance = 4.6;
  const perspective = cameraDistance - elevatedZ;
  const safePerspective = Math.max(1.4, perspective);
  const scale = Math.min(width, height) * 0.58 * camera.zoom;
  const centerX = width * 0.44;
  const centerY = height * 0.58;

  return {
    x: rotatedX,
    y: elevatedY,
    z: elevatedZ,
    sx: centerX + ((rotatedX * scale) / safePerspective),
    sy: centerY - ((elevatedY * scale) / safePerspective),
  };
}

function makeProjectedLabelPoint(
  strike: number,
  day: number,
  value: number,
  prepared: PreparedSurface,
  camera: CameraState,
  plotWidth: number,
  plotHeight: number
) {
  const point = {
    x: lerp(WORLD_BOUNDS.xMin, WORLD_BOUNDS.xMax, normalize(strike, prepared.ranges.strikeMin, prepared.ranges.strikeMax)),
    y: lerp(WORLD_BOUNDS.yMin, WORLD_BOUNDS.yMax, normalize(value, prepared.ranges.valueMin, prepared.ranges.valueMax)),
    z: lerp(WORLD_BOUNDS.zMin, WORLD_BOUNDS.zMax, normalize(day, prepared.ranges.dayMin, prepared.ranges.dayMax)),
  };
  return projectPoint(point, camera, plotWidth, plotHeight);
}

function drawPolyline(ctx: CanvasRenderingContext2D, points: ViewPoint[], strokeStyle: string, lineWidth: number) {
  if (points.length < 2) return;
  ctx.beginPath();
  ctx.moveTo(points[0].sx, points[0].sy);
  for (let index = 1; index < points.length; index += 1) {
    ctx.lineTo(points[index].sx, points[index].sy);
  }
  ctx.strokeStyle = strokeStyle;
  ctx.lineWidth = lineWidth;
  ctx.stroke();
}

function drawPolygon(
  ctx: CanvasRenderingContext2D,
  points: ViewPoint[],
  fillStyle: string,
  strokeStyle?: string,
  lineWidth = 1
) {
  if (points.length < 3) return;
  ctx.beginPath();
  ctx.moveTo(points[0].sx, points[0].sy);
  for (let index = 1; index < points.length; index += 1) {
    ctx.lineTo(points[index].sx, points[index].sy);
  }
  ctx.closePath();
  ctx.fillStyle = fillStyle;
  ctx.fill();
  if (strokeStyle) {
    ctx.strokeStyle = strokeStyle;
    ctx.lineWidth = lineWidth;
    ctx.stroke();
  }
}

function drawAxisLabel(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  rotation = 0
) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rotation);
  ctx.font = "12px SFMono-Regular, Consolas, 'Liberation Mono', Menlo, monospace";
  ctx.fillStyle = "rgba(205, 216, 235, 0.9)";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, 0, 0);
  ctx.restore();
}

function buildLegendTicks(prepared: PreparedSurface | null) {
  if (!prepared) return [];
  const { valueMin, valueMax } = prepared.ranges;
  return buildTicks(valueMin, valueMax, 6).reverse();
}

function legendTickOffset(index: number, count: number) {
  if (count <= 1) return 0;
  return (index / (count - 1)) * 100;
}

export function Surface3DCanvas({ grid, height, mode, onActivate }: Surface3DCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const suppressClickRef = useRef(false);
  const width = useContainerWidth(containerRef);
  const [camera, setCamera] = useState<CameraState>(() => ({ ...DEFAULT_CAMERA }));

  const prepared = useMemo(() => prepareSurface(grid, mode), [grid, mode]);
  const legendTicks = useMemo(() => buildLegendTicks(prepared), [prepared]);
  const gradientCss = useMemo(() => toGradientCss(), []);

  const resetCamera = useCallback(() => {
    setCamera({ ...DEFAULT_CAMERA });
  }, []);

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLCanvasElement>) => {
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      azimuth: camera.azimuth,
      elevation: camera.elevation,
      moved: false,
    };
    suppressClickRef.current = false;
    event.currentTarget.setPointerCapture(event.pointerId);
  }, [camera.azimuth, camera.elevation]);

  const onPointerMove = useCallback((event: ReactPointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) {
      drag.moved = true;
    }
    setCamera((current) => ({
      ...current,
      azimuth: drag.azimuth + (dx * 0.0085),
      elevation: clamp(drag.elevation - (dy * 0.0065), 0.18, 1.18),
    }));
  }, []);

  const onPointerUp = useCallback((event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (dragRef.current?.pointerId === event.pointerId) {
      suppressClickRef.current = dragRef.current.moved;
      dragRef.current = null;
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);

  const onClick = useCallback(() => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    onActivate?.();
  }, [onActivate]);

  const onWheel = useCallback((event: ReactWheelEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    const scaleFactor = Math.exp(-event.deltaY * 0.0014);
    setCamera((current) => ({
      ...current,
      zoom: clamp(current.zoom * scaleFactor, 0.78, 1.72),
    }));
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || width <= 0 || height <= 0) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(width * dpr));
    canvas.height = Math.max(1, Math.round(height * dpr));
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    ctx.clearRect(0, 0, width, height);

    const background = ctx.createLinearGradient(0, 0, 0, height);
    background.addColorStop(0, "#03060b");
    background.addColorStop(0.65, "#050910");
    background.addColorStop(1, "#02050b");
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, width, height);

    const glowLeft = ctx.createRadialGradient(width * 0.18, height * 0.18, 12, width * 0.18, height * 0.18, width * 0.48);
    glowLeft.addColorStop(0, "rgba(44, 125, 255, 0.12)");
    glowLeft.addColorStop(1, "rgba(44, 125, 255, 0)");
    ctx.fillStyle = glowLeft;
    ctx.fillRect(0, 0, width, height);

    const glowRight = ctx.createRadialGradient(width * 0.82, height * 0.1, 16, width * 0.82, height * 0.1, width * 0.36);
    glowRight.addColorStop(0, "rgba(255, 120, 72, 0.12)");
    glowRight.addColorStop(1, "rgba(255, 120, 72, 0)");
    ctx.fillStyle = glowRight;
    ctx.fillRect(0, 0, width, height);

    if (!prepared) {
      ctx.font = "12px SFMono-Regular, Consolas, 'Liberation Mono', Menlo, monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "rgba(150, 168, 196, 0.84)";
      ctx.fillText("No surface grid available", width / 2, height / 2);
      return;
    }

    const project = (point: { x: number; y: number; z: number }) => projectPoint(point, camera, width, height);
    const floorY = WORLD_BOUNDS.yMin;
    const xMin = WORLD_BOUNDS.xMin;
    const xMax = WORLD_BOUNDS.xMax;
    const zMin = WORLD_BOUNDS.zMin;
    const zMax = WORLD_BOUNDS.zMax;
    const yMax = WORLD_BOUNDS.yMax;

    const floor = [
      project({ x: xMin, y: floorY, z: zMin }),
      project({ x: xMax, y: floorY, z: zMin }),
      project({ x: xMax, y: floorY, z: zMax }),
      project({ x: xMin, y: floorY, z: zMax }),
    ];
    const backWall = [
      project({ x: xMin, y: floorY, z: zMax }),
      project({ x: xMax, y: floorY, z: zMax }),
      project({ x: xMax, y: yMax, z: zMax }),
      project({ x: xMin, y: yMax, z: zMax }),
    ];
    const sideWall = [
      project({ x: xMin, y: floorY, z: zMin }),
      project({ x: xMin, y: floorY, z: zMax }),
      project({ x: xMin, y: yMax, z: zMax }),
      project({ x: xMin, y: yMax, z: zMin }),
    ];

    drawPolygon(ctx, floor, "rgba(15, 26, 40, 0.68)", "rgba(184, 194, 210, 0.22)", 1);
    drawPolygon(ctx, backWall, "rgba(11, 18, 28, 0.38)", "rgba(184, 194, 210, 0.16)", 1);
    drawPolygon(ctx, sideWall, "rgba(10, 18, 26, 0.32)", "rgba(184, 194, 210, 0.16)", 1);

    ctx.lineWidth = 1;
    const gridColor = "rgba(197, 207, 223, 0.18)";
    for (const tick of prepared.ticks.strike) {
      const x = lerp(xMin, xMax, normalize(tick, prepared.ranges.strikeMin, prepared.ranges.strikeMax));
      drawPolyline(
        ctx,
        [project({ x, y: floorY, z: zMin }), project({ x, y: floorY, z: zMax }), project({ x, y: yMax, z: zMax })],
        gridColor,
        1
      );
    }
    for (const tick of prepared.ticks.day) {
      const z = lerp(zMin, zMax, normalize(tick, prepared.ranges.dayMin, prepared.ranges.dayMax));
      drawPolyline(
        ctx,
        [project({ x: xMin, y: floorY, z }), project({ x: xMax, y: floorY, z }), project({ x: xMin, y: yMax, z })],
        gridColor,
        1
      );
    }
    for (const tick of prepared.ticks.value) {
      const y = lerp(floorY, yMax, normalize(tick, prepared.ranges.valueMin, prepared.ranges.valueMax));
      drawPolyline(
        ctx,
        [project({ x: xMin, y, z: zMax }), project({ x: xMax, y, z: zMax })],
        gridColor,
        1
      );
      drawPolyline(
        ctx,
        [project({ x: xMin, y, z: zMin }), project({ x: xMin, y, z: zMax })],
        gridColor,
        1
      );
    }

    type Quad = {
      depth: number;
      colorValue: number;
      corners: [ViewPoint, ViewPoint, ViewPoint, ViewPoint];
    };

    const quads: Quad[] = [];
    for (let rowIndex = 0; rowIndex < prepared.rows.length - 1; rowIndex += 1) {
      const leftRow = prepared.rows[rowIndex];
      const rightRow = prepared.rows[rowIndex + 1];
      const columnCount = Math.min(leftRow.points.length, rightRow.points.length);
      for (let columnIndex = 0; columnIndex < columnCount - 1; columnIndex += 1) {
        const topLeft = leftRow.points[columnIndex];
        const topRight = leftRow.points[columnIndex + 1];
        const bottomLeft = rightRow.points[columnIndex];
        const bottomRight = rightRow.points[columnIndex + 1];

        if ([topLeft, topRight, bottomLeft, bottomRight].some((point) => point.value == null)) {
          continue;
        }

        const projected = [topLeft, topRight, bottomRight, bottomLeft].map(project);
        const depth = projected.reduce((sum, point) => sum + point.z, 0) / projected.length;
        const colorValue =
          (((topLeft.value ?? 0) + (topRight.value ?? 0) + (bottomLeft.value ?? 0) + (bottomRight.value ?? 0)) / 4);

        quads.push({
          depth,
          colorValue,
          corners: projected as [ViewPoint, ViewPoint, ViewPoint, ViewPoint],
        });
      }
    }

    quads
      .sort((left, right) => left.depth - right.depth)
      .forEach((quad) => {
        const color = interpolatePalette(
          normalize(quad.colorValue, prepared.ranges.valueMin, prepared.ranges.valueMax),
          0.92
        );
        drawPolygon(ctx, quad.corners, color, "rgba(255, 255, 255, 0.035)", 0.7);
      });

    prepared.rows.forEach((row) => {
      const projected = row.points
        .filter((point) => point.value != null)
        .map(project);
      drawPolyline(ctx, projected, "rgba(255, 255, 255, 0.12)", 1);
    });

    const rowCount = prepared.rows.length;
    const columnCount = prepared.rows[0]?.points.length ?? 0;
    for (let columnIndex = 0; columnIndex < columnCount; columnIndex += 3) {
      const projected = prepared.rows
        .map((row) => row.points[columnIndex])
        .filter((point): point is PreparedPoint => point != null && point.value != null)
        .map(project);
      drawPolyline(ctx, projected, "rgba(255, 255, 255, 0.09)", 0.9);
    }

    const termStructurePlaneX = xMin - 0.54;
    const termStructureIndices = pickSpreadIndices(columnCount, Math.min(6, columnCount));
    termStructureIndices.forEach((columnIndex, index) => {
      const projected = prepared.rows
        .map((row) => row.points[columnIndex])
        .filter((point): point is PreparedPoint => point != null && point.value != null)
        .map((point) =>
          project({
            x: termStructurePlaneX + (index * 0.06),
            y: point.y,
            z: point.z,
          })
        );
      drawPolyline(ctx, projected, interpolatePalette(index / Math.max(1, termStructureIndices.length - 1), 0.92), 2);
    });

    const skewPlaneZ = zMin - 0.36;
    const skewIndices = pickSpreadIndices(rowCount, Math.min(6, rowCount));
    skewIndices.forEach((rowIndex, index) => {
      const row = prepared.rows[rowIndex];
      const projected = row.points
        .filter((point) => point.value != null)
        .map((point) =>
          project({
            x: point.x + 0.34,
            y: point.y,
            z: skewPlaneZ + (index * 0.06),
          })
        );
      drawPolyline(ctx, projected, interpolatePalette(index / Math.max(1, skewIndices.length - 1), 0.92), 2);
    });

    const strikeAxisStart = project({ x: xMin, y: floorY, z: zMin });
    const strikeAxisEnd = project({ x: xMax, y: floorY, z: zMin });
    const dayAxisStart = project({ x: xMax, y: floorY, z: zMin });
    const dayAxisEnd = project({ x: xMax, y: floorY, z: zMax });
    const valueAxisStart = project({ x: xMax, y: floorY, z: zMax });
    const valueAxisEnd = project({ x: xMax, y: yMax, z: zMax });

    drawPolyline(ctx, [strikeAxisStart, strikeAxisEnd], "rgba(226, 234, 246, 0.62)", 1.2);
    drawPolyline(ctx, [dayAxisStart, dayAxisEnd], "rgba(226, 234, 246, 0.62)", 1.2);
    drawPolyline(ctx, [valueAxisStart, valueAxisEnd], "rgba(226, 234, 246, 0.62)", 1.2);

    ctx.font = "11px SFMono-Regular, Consolas, 'Liberation Mono', Menlo, monospace";
    ctx.fillStyle = "rgba(195, 207, 227, 0.88)";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    prepared.ticks.strike.forEach((tick) => {
      const point = makeProjectedLabelPoint(
        tick,
        prepared.ranges.dayMin,
        prepared.ranges.valueMin,
        prepared,
        camera,
        width,
        height
      );
      ctx.fillText(formatTick(tick, prepared.useStrikeAxis), point.sx, point.sy + 20);
    });
    prepared.ticks.day.forEach((tick) => {
      const point = makeProjectedLabelPoint(
        prepared.ranges.strikeMax,
        tick,
        prepared.ranges.valueMin,
        prepared,
        camera,
        width,
        height
      );
      ctx.fillText(formatTick(tick), point.sx + 26, point.sy + 6);
    });
    prepared.ticks.value.forEach((tick) => {
      const point = makeProjectedLabelPoint(
        prepared.ranges.strikeMax,
        prepared.ranges.dayMax,
        tick,
        prepared,
        camera,
        width,
        height
      );
      ctx.fillText(formatTick(tick), point.sx + 28, point.sy);
    });

    drawAxisLabel(
      ctx,
      prepared.useStrikeAxis ? "Strike Price" : "Log-moneyness",
      (strikeAxisStart.sx + strikeAxisEnd.sx) / 2,
      Math.max(strikeAxisStart.sy, strikeAxisEnd.sy) + 42
    );
    drawAxisLabel(
      ctx,
      "Expiration (days)",
      (dayAxisStart.sx + dayAxisEnd.sx) / 2 + 42,
      (dayAxisStart.sy + dayAxisEnd.sy) / 2 + 18,
      0.35
    );
    drawAxisLabel(
      ctx,
      prepared.zLabel,
      valueAxisEnd.sx + 66,
      (valueAxisStart.sy + valueAxisEnd.sy) / 2,
      -Math.PI / 2
    );

    const termLabel = project({ x: termStructurePlaneX + 0.16, y: yMax + 0.08, z: zMax - 0.2 });
    const skewLabel = project({ x: xMax + 0.32, y: yMax + 0.04, z: skewPlaneZ + 0.18 });
    ctx.font = "600 12px system-ui, sans-serif";
    ctx.fillStyle = "rgba(230, 236, 246, 0.82)";
    ctx.fillText("Term Structure", termLabel.sx, termLabel.sy);
    ctx.fillText("Skew", skewLabel.sx, skewLabel.sy);
  }, [camera, height, prepared, width]);

  if (!prepared) {
    return (
      <div ref={containerRef} className="chart-frame surface-3d-frame" style={{ height }}>
        <div className="surface-3d-empty">No surface grid available</div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="chart-frame surface-3d-frame" style={{ height }}>
      <canvas
        ref={canvasRef}
        className="surface-3d-canvas"
        onClick={onClick}
        onDoubleClick={resetCamera}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={onWheel}
      />
      <div className="surface-3d-instruction">Drag rotate / wheel zoom / double-click reset</div>
      <div className="surface-3d-scale" aria-hidden="true">
        <div className="surface-3d-scale-bar" style={{ backgroundImage: gradientCss }} />
        <div className="surface-3d-scale-ticks">
          {legendTicks.map((tick, index) => (
            <div
              key={`${mode}-${tick}-${index}`}
              className="surface-3d-scale-tick"
              style={{ top: `${legendTickOffset(index, legendTicks.length)}%` }}
            >
              <span>{formatTick(tick)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
