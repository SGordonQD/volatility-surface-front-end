import type {
  BookLevel,
  CurveRow,
  Margin,
  QuotesByExpiry,
  ScatterRow,
  SmilePointByExchange,
  SmileChartRow,
  SmileLevelDelete,
  SmileLevelsPatchMessage,
  SmilePoint,
  SmileLevelsSnapshotMessage,
  SmilePointUpdateMessage,
  SmileSnapshotMessage,
  SviSmile,
  SviSurfaceGrid,
  SviSurfaceSnapshot,
  VarianceSeries,
} from "./svi-types";

function resolveWsUrlFromEnv(rawValue: unknown): string | null {
  if (typeof rawValue !== "string") return null;
  const value = rawValue.trim();
  if (!value) return null;

  if (value.startsWith("ws://") || value.startsWith("wss://")) {
    return value;
  }

  if (value.startsWith("http://") || value.startsWith("https://")) {
    try {
      const url = new URL(value);
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
      return url.toString();
    } catch {
      return null;
    }
  }

  if (value.startsWith("/")) {
    if (typeof window === "undefined") return null;
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${protocol}//${window.location.host}${value}`;
  }

  return null;
}

export const FALLBACK_WS_URL =
  resolveWsUrlFromEnv(import.meta.env.VITE_SVI_WS_URL) ?? "ws://localhost:8765";
export const RECONNECT_DELAYS_MS = [2000, 4000, 8000, 15000];
export const MAX_BID_POINTS_PER_SMILE = 320;
export const MAX_ASK_POINTS_PER_SMILE = 320;
const MAX_AXIS_TICKS = 512;
const MAX_RENDER_SCATTER_POINTS = 1600;
const MAX_THROUGH_MATRIX_STRIKES = 320;
const MAX_TRACKED_EXPIRIES = 64;
const STALE_QUOTE_MAX_AGE_MS = 20 * 60 * 1000;
const MAX_LEVELS_PER_SIDE_PER_STRIKE = 24;
const MAX_STRIKES_PER_SMILE = 900;
const SURFACE_GRID_FALLBACK_MIN_X = -2;
const SURFACE_GRID_FALLBACK_MAX_X = 2;
const SURFACE_GRID_FALLBACK_STEP = 0.05;
export const FITTED_CURVE_COLOR = "#ff9f2a";
const TRADE_FLASH_DURATION_MS = 10_000;

export type ThroughMatrixSide = "neutral" | "bid" | "ask";

export type SmileThroughCell = {
  strike: number;
  side: ThroughMatrixSide;
  throughValue: number;
  sviIv: number | null;
  bestBidIv: number | null;
  bestAskIv: number | null;
  bidThrough: number;
  askThrough: number;
  bestBidIvDeribit: number | null;
  bestAskIvDeribit: number | null;
  bestBidIvOkx: number | null;
  bestAskIvOkx: number | null;
  bidThroughDeribit: number;
  askThroughDeribit: number;
  bidThroughOkx: number;
  askThroughOkx: number;
  okxBidThrough: boolean;
  okxAskThrough: boolean;
};

export type SmileThroughRow = {
  expiry: number;
  label: string;
  cellsByStrike: Record<string, SmileThroughCell>;
  activeCount: number;
};

export type SmileThroughMatrix = {
  strikes: number[];
  rows: SmileThroughRow[];
  maxThrough: number;
};

export const palette = [
  "#ff9f2a",
  "#6ea5ff",
  "#f5c96a",
  "#7dc0ff",
  "#e58c2d",
  "#9cc5ff",
  "#d9a85f",
  "#5ea9f2",
  "#f0b267",
  "#89b5e4",
  "#c6d1df",
  "#aebdce",
  "#f6a94b",
  "#79b1ff",
  "#d4b680",
  "#679fd8",
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
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return null;
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
  if (max < min) return [];

  const span = max - min;
  let effectiveStep = step;
  const estimatedTickCount = Math.floor(span / effectiveStep) + 1;
  if (estimatedTickCount > MAX_AXIS_TICKS) {
    const multiplier = Math.ceil(estimatedTickCount / MAX_AXIS_TICKS);
    effectiveStep = step * Math.max(1, multiplier);
  }

  const ticks: number[] = [];
  for (let value = min; value <= max + effectiveStep * 0.5; value += effectiveStep) {
    if (ticks.length >= MAX_AXIS_TICKS) break;
    ticks.push(Number(value.toFixed(10)));
  }

  if (ticks.length > 0) {
    const last = ticks[ticks.length - 1];
    if (last < max - effectiveStep * 0.25 && ticks.length < MAX_AXIS_TICKS) {
      ticks.push(Number(max.toFixed(10)));
    }
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

function mergeBookLevels(
  existingLevels: BookLevel[] | undefined,
  incomingLevels: BookLevel[] | undefined,
  incomingBestIv: number | null
) {
  const clampLevels = (levels: BookLevel[] | undefined) => {
    if (!Array.isArray(levels) || levels.length === 0) return levels;

    const deduped = new Map<string, BookLevel>();
    for (let idx = 0; idx < levels.length; idx += 1) {
      const level = levels[idx];
      if (!level || typeof level !== "object") continue;

      const idKey = typeof level.id === "string" && level.id.trim() ? level.id.trim() : null;
      const exchange = typeof level.exchange === "string" ? level.exchange.trim().toLowerCase() : "";
      const ticker = typeof level.ticker === "string" ? level.ticker.trim() : "";
      const side = normalizeSide(level.side);
      const price = safeNumber(level.price);
      const fallbackKey = `${exchange}|${ticker}|${side}|${price ?? "na"}|${idx}`;
      deduped.set(idKey ?? fallbackKey, level);
    }

    const normalized = [...deduped.values()];
    if (normalized.length <= MAX_LEVELS_PER_SIDE_PER_STRIKE) return normalized;
    return normalized.slice(normalized.length - MAX_LEVELS_PER_SIDE_PER_STRIKE);
  };

  if (!Array.isArray(incomingLevels)) {
    return clampLevels(existingLevels);
  }

  if (incomingLevels.length === 0) {
    // If best IV is present, treat empty levels as intentional "best-only" state.
    if (incomingBestIv != null) {
      return [];
    }
    // Otherwise, preserve last known levels to avoid transient wipe flicker.
    if (Array.isArray(existingLevels) && existingLevels.length > 0) {
      return clampLevels(existingLevels);
    }
  }

  return clampLevels(incomingLevels);
}

const TRADE_SIDE_VALUES = new Set([
  "trade",
  "last_trade",
  "last",
  "fill",
  "filled",
  "ltp",
  "trd",
]);

const BID_SIDE_VALUES = new Set(["bid"]);
const ASK_SIDE_VALUES = new Set(["ask", "offer"]);

const TRADE_IV_KEYS = [
  "last_trade_iv",
  "lastTradeIV",
  "lastTradeIv",
  "trade_iv",
  "tradeIv",
  "last_iv",
  "lastIv",
  "fill_iv",
  "fillIv",
] as const;

const TRADE_PRICE_KEYS = [
  "last_trade_price",
  "lastTradePrice",
  "trade_price",
  "tradePrice",
  "last_price",
  "lastPrice",
  "fill_price",
  "fillPrice",
] as const;

const TRADE_LEVEL_ARRAY_KEYS = [
  "last_trades",
  "lastTrades",
  "last_trade_levels",
  "lastTradeLevels",
  "trade_levels",
  "tradeLevels",
  "last_levels",
  "lastLevels",
  "trades",
] as const;

const LOG_MONEYNESS_KEYS = ["log_moneyness", "logMoneyness", "x"] as const;

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  return value as Record<string, unknown>;
}

function normalizeSide(value: unknown) {
  if (typeof value !== "string") return "";
  return value.trim().toLowerCase();
}

function readNumericAliases(source: unknown, aliases: readonly string[]) {
  const record = asRecord(source);
  if (!record) return null;

  for (const alias of aliases) {
    const parsed = safeNumber(record[alias]);
    if (parsed != null) return parsed;
  }

  return null;
}

function readBookLevelArrayAliases(source: unknown, aliases: readonly string[]) {
  const record = asRecord(source);
  if (!record) return [];

  const levels: BookLevel[] = [];
  for (const alias of aliases) {
    const candidate = record[alias];
    if (!Array.isArray(candidate)) continue;

    for (const item of candidate) {
      if (!item || typeof item !== "object") continue;
      levels.push(item as BookLevel);
    }
  }

  return levels;
}

function readBookLevelsFromRecord(
  record: Record<string, unknown> | null,
  key: string
): BookLevel[] | undefined {
  if (!record) return undefined;
  const candidate = record[key];
  if (!Array.isArray(candidate)) return undefined;

  return candidate.filter((item): item is BookLevel => item != null && typeof item === "object");
}

function resolvePointByExchange(point: SmilePoint, exchange: string): SmilePointByExchange | null {
  const byExchangeRecord = asRecord((point as { by_exchange?: unknown }).by_exchange);
  if (!byExchangeRecord) return null;

  const target = exchange.trim().toLowerCase();
  if (!target) return null;

  for (const [key, value] of Object.entries(byExchangeRecord)) {
    if (key.trim().toLowerCase() !== target) continue;
    const exchangeRecord = asRecord(value);
    if (!exchangeRecord) return null;
    return exchangeRecord as SmilePointByExchange;
  }

  return null;
}

function hasTradeFlag(source: unknown) {
  const record = asRecord(source);
  if (!record) return false;

  return (
    record.is_trade === true ||
    record.isTrade === true ||
    record.is_last_trade === true ||
    record.isLastTrade === true ||
    record.is_fill === true ||
    record.isFill === true ||
    record.trade === true ||
    record.last_trade === true
  );
}

function hasTradeToken(value: unknown) {
  if (typeof value !== "string") return false;
  const lowered = value.toLowerCase();
  return (
    lowered.includes(":trade:") ||
    lowered.includes(":trade") ||
    lowered.includes(":last:") ||
    lowered.includes(":last_trade")
  );
}

function isTradeSide(value: unknown) {
  return TRADE_SIDE_VALUES.has(normalizeSide(value));
}

function isBidSide(value: unknown) {
  return BID_SIDE_VALUES.has(normalizeSide(value));
}

function isAskSide(value: unknown) {
  return ASK_SIDE_VALUES.has(normalizeSide(value));
}

function resolveLevelTradeInfo(level: BookLevel | null | undefined) {
  if (!level) {
    return {
      isTrade: false,
      iv: null as number | null,
      price: null as number | null,
    };
  }

  const hintedIv = normalizeIvForChart(readNumericAliases(level, TRADE_IV_KEYS));
  const hintedPrice = readNumericAliases(level, TRADE_PRICE_KEYS);
  const explicitTrade =
    isTradeSide(level.side) ||
    hintedIv != null ||
    hintedPrice != null ||
    hasTradeFlag(level) ||
    hasTradeToken(level.id) ||
    hasTradeToken(level.ticker);

  if (!explicitTrade) {
    return {
      isTrade: false,
      iv: null as number | null,
      price: null as number | null,
    };
  }

  return {
    isTrade: true,
    iv: hintedIv ?? normalizeIvForChart(level.iv),
    price: hintedPrice ?? safeNumber(level.price),
  };
}

function resolvePointTradeInfo(point: SmilePoint, useBboFallback = false) {
  let iv = normalizeIvForChart(readNumericAliases(point, TRADE_IV_KEYS));
  let price = readNumericAliases(point, TRADE_PRICE_KEYS);
  let tradeLevel: BookLevel | null = point.last_trade_level ?? null;
  let tradeLevels: BookLevel[] | undefined = Array.isArray(point.last_trade_levels)
    ? point.last_trade_levels
    : undefined;

  const aliasTradeLevels = readBookLevelArrayAliases(point, TRADE_LEVEL_ARRAY_KEYS);
  if (!tradeLevels && aliasTradeLevels.length > 0) {
    tradeLevels = aliasTradeLevels;
  }

  const candidateLevels: BookLevel[] = [
    ...(tradeLevel ? [tradeLevel] : []),
    ...(tradeLevels ?? []),
    ...aliasTradeLevels,
    ...(point.bid_levels ?? []),
    ...(point.ask_levels ?? []),
  ];

  for (let idx = candidateLevels.length - 1; idx >= 0; idx -= 1) {
    const level = candidateLevels[idx];
    const tradeInfo = resolveLevelTradeInfo(level);
    if (!tradeInfo.isTrade) continue;

    iv = iv ?? tradeInfo.iv;
    price = price ?? tradeInfo.price;
    tradeLevel = tradeLevel ?? level;
    tradeLevels = tradeLevels ?? [level];

    if (iv != null && price != null) break;
  }

  if (useBboFallback && iv == null && price != null) {
    const bestBidIv = normalizeIvForChart(point.best_bid_iv);
    const bestAskIv = normalizeIvForChart(point.best_ask_iv);

    if (bestBidIv != null && bestAskIv != null) {
      iv = (bestBidIv + bestAskIv) / 2;
    } else {
      iv = bestBidIv ?? bestAskIv;
    }

    if (iv == null) {
      for (const level of [...(point.bid_levels ?? []), ...(point.ask_levels ?? [])]) {
        const fallbackIv = normalizeIvForChart(level.iv);
        if (fallbackIv != null) {
          iv = fallbackIv;
          break;
        }
      }
    }
  }

  return { iv, price, tradeLevel, tradeLevels };
}

function isTradeLevel(level: BookLevel | null | undefined) {
  return resolveLevelTradeInfo(level).isTrade;
}

function mergeSmilePoint(
  existingPoint: SmilePoint | undefined,
  incomingPoint: SmilePoint,
  sourceTs: number | null = null,
  enableTradeFlash = false
): SmilePoint {
  const incomingLogMoneyness = safeNumber(
    (incomingPoint as { log_moneyness?: unknown }).log_moneyness
  );
  const incomingBestBidIv = safeNumber(
    (incomingPoint as { best_bid_iv?: unknown }).best_bid_iv
  );
  const incomingBestAskIv = safeNumber(
    (incomingPoint as { best_ask_iv?: unknown }).best_ask_iv
  );
  const incomingTradeInfo = resolvePointTradeInfo(incomingPoint, false);
  const existingTradeIv = normalizeIvForChart(existingPoint?.last_trade_iv);
  const incomingTradeIv = incomingTradeInfo.iv;
  const tradeIvChanged =
    incomingTradeIv != null &&
    (existingTradeIv == null || Math.abs(existingTradeIv - incomingTradeIv) > 1e-8);
  const updateTs = sourceTs ?? Date.now();
  const nextTradeUpdateTs =
    tradeIvChanged
      ? updateTs
      : existingPoint?.last_trade_update_ts ?? null;
  const nextTradeFlashUntilTs = tradeIvChanged
    ? (enableTradeFlash ? updateTs + TRADE_FLASH_DURATION_MS : null)
    : existingPoint?.last_trade_flash_until_ts ?? null;
  const existingByExchange = asRecord((existingPoint as { by_exchange?: unknown } | undefined)?.by_exchange);
  const incomingByExchange = asRecord((incomingPoint as { by_exchange?: unknown }).by_exchange);
  let mergedByExchange: SmilePoint["by_exchange"] | undefined;
  if (existingByExchange || incomingByExchange) {
    const keys = new Set<string>([
      ...Object.keys(existingByExchange ?? {}),
      ...Object.keys(incomingByExchange ?? {}),
    ]);

    const nextByExchange: Record<string, SmilePointByExchange> = {};
    for (const key of keys) {
      const existingExchange = asRecord(existingByExchange?.[key]);
      const incomingExchange = asRecord(incomingByExchange?.[key]);
      if (!existingExchange && !incomingExchange) continue;
      if (!existingExchange && incomingExchange) {
        nextByExchange[key] = incomingExchange as SmilePointByExchange;
        continue;
      }
      if (existingExchange && !incomingExchange) {
        nextByExchange[key] = existingExchange as SmilePointByExchange;
        continue;
      }

      const incomingExchangeBestBidIv = safeNumber(incomingExchange?.best_bid_iv);
      const incomingExchangeBestAskIv = safeNumber(incomingExchange?.best_ask_iv);
      const nextExchange = {
        ...existingExchange,
        ...incomingExchange,
        bid_levels: mergeBookLevels(
          readBookLevelsFromRecord(existingExchange, "bid_levels"),
          readBookLevelsFromRecord(incomingExchange, "bid_levels"),
          incomingExchangeBestBidIv
        ),
        ask_levels: mergeBookLevels(
          readBookLevelsFromRecord(existingExchange, "ask_levels"),
          readBookLevelsFromRecord(incomingExchange, "ask_levels"),
          incomingExchangeBestAskIv
        ),
        best_bid_iv: incomingExchangeBestBidIv ?? safeNumber(existingExchange?.best_bid_iv),
        best_ask_iv: incomingExchangeBestAskIv ?? safeNumber(existingExchange?.best_ask_iv),
      };
      nextByExchange[key] = nextExchange as SmilePointByExchange;
    }

    mergedByExchange = nextByExchange;
  }

  return {
    ...existingPoint,
    ...incomingPoint,
    log_moneyness: incomingLogMoneyness ?? existingPoint?.log_moneyness ?? incomingPoint.log_moneyness,
    bid_levels: mergeBookLevels(existingPoint?.bid_levels, incomingPoint.bid_levels, incomingBestBidIv),
    ask_levels: mergeBookLevels(existingPoint?.ask_levels, incomingPoint.ask_levels, incomingBestAskIv),
    best_bid_iv: incomingBestBidIv ?? existingPoint?.best_bid_iv,
    best_ask_iv: incomingBestAskIv ?? existingPoint?.best_ask_iv,
    last_trade_iv: incomingTradeIv ?? existingTradeIv,
    last_trade_price: incomingTradeInfo.price ?? existingPoint?.last_trade_price,
    last_trade_update_ts: nextTradeUpdateTs,
    last_trade_flash_until_ts: nextTradeFlashUntilTs,
    last_trade_level: incomingTradeInfo.tradeLevel ?? existingPoint?.last_trade_level,
    last_trade_levels: incomingTradeInfo.tradeLevels ?? existingPoint?.last_trade_levels,
    by_exchange: mergedByExchange,
  };
}

type SmileQuoteMessage =
  | SmileSnapshotMessage
  | SmileLevelsSnapshotMessage
  | SmileLevelsPatchMessage
  | SmilePointUpdateMessage;

function resolveMessageAtm(message: SmileQuoteMessage) {
  return (
    safeNumber(message.atm) ??
    safeNumber(message.smile_atm) ??
    safeNumber(message.underlying?.smile_atm) ??
    safeNumber(message.underlying?.source_price) ??
    safeNumber(message.underlying?.mark_price) ??
    safeNumber(message.underlying?.filtered_mid)
  );
}

function resolveMessageLastTradePrice(message: SmileQuoteMessage) {
  return safeNumber(message.last_trade_price) ?? safeNumber(message.underlying?.last_trade_price);
}

function applyPatchDeletes(
  pointsByStrike: Record<string, SmilePoint>,
  deletes: SmileLevelDelete[] | undefined
) {
  if (!Array.isArray(deletes) || deletes.length === 0) return;

  for (const deletion of deletes) {
    const strike = safeNumber(deletion.strike);
    if (strike == null) continue;

    const strikeKey = String(strike);
    const existingPoint = pointsByStrike[strikeKey];
    if (!existingPoint) continue;

    const side = normalizeSide(deletion.side);
    const isTradeDeletion =
      isTradeSide(side) ||
      hasTradeToken(deletion.id) ||
      hasTradeToken(deletion.ticker);
    const isBidDeletion = isBidSide(side);
    const isAskDeletion = isAskSide(side);

    if (!isBidDeletion && !isAskDeletion && !isTradeDeletion) {
      continue;
    }

    if (isTradeDeletion) {
      pointsByStrike[strikeKey] = {
        ...existingPoint,
        last_trade_iv: null,
        last_trade_price: null,
        last_trade_update_ts: null,
        last_trade_flash_until_ts: null,
        last_trade_level: null,
      };
      continue;
    }

    const levelKey = isBidDeletion ? "bid_levels" : "ask_levels";
    const existingLevels = existingPoint[levelKey];
    if (!Array.isArray(existingLevels) || existingLevels.length === 0) continue;

    const nextLevels = existingLevels.filter((level) => {
      if (deletion.id && level.id) return level.id !== deletion.id;
      if (deletion.ticker && level.ticker) return level.ticker !== deletion.ticker;
      return true;
    });

    pointsByStrike[strikeKey] = {
      ...existingPoint,
      [levelKey]: nextLevels,
    };
  }
}

function prunePointsByStrike(
  pointsByStrike: Record<string, SmilePoint>,
  maxPoints = MAX_STRIKES_PER_SMILE
) {
  const entries = Object.entries(pointsByStrike);
  if (entries.length <= maxPoints) return pointsByStrike;

  const ranked = entries
    .map(([strikeKey, point]) => {
      const logMoneyness = safeNumber(point.log_moneyness);
      const priority = logMoneyness == null ? Number.POSITIVE_INFINITY : Math.abs(logMoneyness);
      return { strikeKey, point, priority };
    })
    .sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      const aStrike = safeNumber(a.point.strike) ?? Number.NaN;
      const bStrike = safeNumber(b.point.strike) ?? Number.NaN;
      if (Number.isFinite(aStrike) && Number.isFinite(bStrike)) {
        return aStrike - bStrike;
      }
      return a.strikeKey.localeCompare(b.strikeKey);
    });

  const next: Record<string, SmilePoint> = {};
  for (let idx = 0; idx < Math.min(maxPoints, ranked.length); idx += 1) {
    const item = ranked[idx];
    next[item.strikeKey] = item.point;
  }

  return next;
}

function applyPatchUpserts(
  pointsByStrike: Record<string, SmilePoint>,
  upserts: BookLevel[] | undefined,
  sourceTs: number | null = null,
  enableTradeFlash = false
) {
  if (!Array.isArray(upserts) || upserts.length === 0) return;

  for (const upsert of upserts) {
    const strike = safeNumber(upsert.strike);
    if (strike == null) continue;

    const strikeKey = String(strike);
    let existingPoint = pointsByStrike[strikeKey];
    if (!existingPoint) {
      const inferredLogMoneyness = readNumericAliases(upsert, LOG_MONEYNESS_KEYS);
      if (inferredLogMoneyness == null) continue;

      existingPoint = {
        strike,
        log_moneyness: inferredLogMoneyness,
      };
      pointsByStrike[strikeKey] = existingPoint;
    }

    const side = normalizeSide(upsert.side);
    const levelTradeInfo = resolveLevelTradeInfo(upsert);
    const isExplicitTradeUpsert = isTradeSide(side);
    const isBidUpsert = isBidSide(side);
    const isAskUpsert = isAskSide(side);
    const existingTradeIv = normalizeIvForChart(existingPoint.last_trade_iv);
    const tradeIvChanged =
      levelTradeInfo.iv != null &&
      (existingTradeIv == null || Math.abs(existingTradeIv - levelTradeInfo.iv) > 1e-8);
    const updateTs = sourceTs ?? Date.now();
    const nextTradeUpdateTs =
      tradeIvChanged
        ? updateTs
        : existingPoint.last_trade_update_ts ?? null;
    const nextTradeFlashUntilTs =
      tradeIvChanged
        ? (enableTradeFlash ? updateTs + TRADE_FLASH_DURATION_MS : null)
        : existingPoint.last_trade_flash_until_ts ?? null;

    if (isExplicitTradeUpsert || (!isBidUpsert && !isAskUpsert && levelTradeInfo.isTrade)) {
      pointsByStrike[strikeKey] = {
        ...existingPoint,
        last_trade_iv: levelTradeInfo.iv ?? existingTradeIv,
        last_trade_price: levelTradeInfo.price ?? existingPoint.last_trade_price ?? null,
        last_trade_update_ts: nextTradeUpdateTs,
        last_trade_flash_until_ts: nextTradeFlashUntilTs,
        last_trade_level: {
          ...(existingPoint.last_trade_level ?? {}),
          ...upsert,
        },
      };
      continue;
    }

    if (!isBidUpsert && !isAskUpsert) {
      continue;
    }

    const levelKey = isBidUpsert ? "bid_levels" : "ask_levels";
    const existingLevels = Array.isArray(existingPoint[levelKey]) ? [...existingPoint[levelKey]!] : [];
    const upsertId = typeof upsert.id === "string" ? upsert.id : null;

    const nextLevels =
      upsertId != null
        ? (() => {
            const existingIndex = existingLevels.findIndex((level) => level.id === upsertId);
            if (existingIndex >= 0) {
              const replaced = [...existingLevels];
              replaced[existingIndex] = { ...replaced[existingIndex], ...upsert };
              return replaced;
            }
            return [...existingLevels, upsert];
          })()
        : [...existingLevels, upsert];
    const normalizedNextLevels = mergeBookLevels(undefined, nextLevels, null) ?? nextLevels;

    let nextPoint: SmilePoint = {
      ...existingPoint,
      [levelKey]: normalizedNextLevels,
    };

    if (levelTradeInfo.isTrade) {
      nextPoint = {
        ...nextPoint,
        last_trade_iv: levelTradeInfo.iv ?? normalizeIvForChart(nextPoint.last_trade_iv),
        last_trade_price: levelTradeInfo.price ?? nextPoint.last_trade_price ?? null,
        last_trade_update_ts: nextTradeUpdateTs,
        last_trade_flash_until_ts: nextTradeFlashUntilTs,
        last_trade_level: {
          ...(nextPoint.last_trade_level ?? {}),
          ...upsert,
        },
      };
    }

    pointsByStrike[strikeKey] = nextPoint;
  }
}

export function applySmileSnapshot(current: QuotesByExpiry, msg: SmileSnapshotMessage): QuotesByExpiry {
  const expiryKey = String(msg.expiry);
  const existing = current[expiryKey];
  const nextTs = Math.max(existing?.ts ?? Number.NEGATIVE_INFINITY, msg.ts);
  const nextAtm = resolveMessageAtm(msg);
  const nextAtmVersion = safeNumber(msg.atm_version);
  const nextLastTradePrice = resolveMessageLastTradePrice(msg);
  const existingAtmVersion = existing?.atmVersion ?? null;

  // Some feeds emit transient empty snapshots before the next populated quote batch.
  // Keep the last populated smile to avoid the chart flashing down to just the fitted line.
  if (existing && (msg.points?.length ?? 0) === 0) {
    return {
      ...current,
      [expiryKey]: {
        ...existing,
        ts: nextTs,
        label: msg.label ?? existing.label,
      },
    };
  }

  const pointsByStrike: Record<string, typeof msg.points[number]> = {
    ...(existing?.pointsByStrike ?? {}),
  };
  for (const point of msg.points ?? []) {
    const strikeKey = String(point.strike);
    const existingPoint = pointsByStrike[strikeKey];
    pointsByStrike[strikeKey] = mergeSmilePoint(existingPoint, point, msg.ts, false);
  }

  const nextPointsByStrike = prunePointsByStrike(pointsByStrike);

  return {
    ...current,
    [expiryKey]: {
      ts: nextTs,
      atm: nextAtm ?? existing?.atm ?? null,
      atmVersion: nextAtmVersion ?? existingAtmVersion,
      lastTradePrice: nextLastTradePrice ?? existing?.lastTradePrice ?? null,
      label: msg.label ?? existing?.label,
      pointsByStrike: nextPointsByStrike,
    },
  };
}

export function applySmileLevelsSnapshot(
  current: QuotesByExpiry,
  msg: SmileLevelsSnapshotMessage | SmileLevelsPatchMessage
): QuotesByExpiry {
  const expiryKey = String(msg.expiry);
  const existing = current[expiryKey];
  const nextTs = Math.max(existing?.ts ?? Number.NEGATIVE_INFINITY, msg.ts);
  const nextAtm = resolveMessageAtm(msg);
  const nextAtmVersion = safeNumber(msg.atm_version);
  const nextLastTradePrice = resolveMessageLastTradePrice(msg);
  const existingAtmVersion = existing?.atmVersion ?? null;

  const shouldFlashTradeUpdates = msg.type === "smile_levels_patch";
  const pointsByStrike: Record<string, typeof msg.points[number]> = {
    ...(existing?.pointsByStrike ?? {}),
  };
  for (const point of msg.points ?? []) {
    const strikeKey = String(point.strike);
    const existingPoint = pointsByStrike[strikeKey];
    pointsByStrike[strikeKey] = mergeSmilePoint(
      existingPoint,
      point,
      msg.ts,
      shouldFlashTradeUpdates
    );
  }
  applyPatchUpserts(
    pointsByStrike,
    "upserts" in msg ? msg.upserts : undefined,
    msg.ts,
    shouldFlashTradeUpdates
  );
  applyPatchDeletes(pointsByStrike, "deletes" in msg ? msg.deletes : undefined);

  const nextPointsByStrike = prunePointsByStrike(pointsByStrike);

  return {
    ...current,
    [expiryKey]: {
      ts: nextTs,
      atm: nextAtm ?? existing?.atm ?? null,
      atmVersion: nextAtmVersion ?? existingAtmVersion,
      lastTradePrice: nextLastTradePrice ?? existing?.lastTradePrice ?? null,
      label: msg.label ?? existing?.label,
      pointsByStrike: nextPointsByStrike,
    },
  };
}

export function applySmilePointUpdate(
  current: QuotesByExpiry,
  msg: SmilePointUpdateMessage
): QuotesByExpiry {
  const expiryKey = String(msg.expiry);
  const existing = current[expiryKey];
  const nextTs = Math.max(existing?.ts ?? Number.NEGATIVE_INFINITY, msg.ts);
  const nextAtm = resolveMessageAtm(msg);
  const nextAtmVersion = safeNumber(msg.atm_version);
  const nextLastTradePrice = resolveMessageLastTradePrice(msg);
  const existingAtmVersion = existing?.atmVersion ?? null;

  const nextPointsByStrike = { ...(existing?.pointsByStrike ?? {}) };
  for (const point of msg.points ?? []) {
    const strikeKey = String(point.strike);
    const existingPoint = nextPointsByStrike[strikeKey];
    nextPointsByStrike[strikeKey] = mergeSmilePoint(existingPoint, point, msg.ts, true);
  }

  const prunedPointsByStrike = prunePointsByStrike(nextPointsByStrike);

  return {
    ...current,
    [expiryKey]: {
      ts: nextTs,
      atm: nextAtm ?? existing?.atm ?? null,
      atmVersion: nextAtmVersion ?? existingAtmVersion,
      lastTradePrice: nextLastTradePrice ?? existing?.lastTradePrice ?? null,
      label: msg.label ?? existing?.label,
      pointsByStrike: prunedPointsByStrike,
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

export function pruneQuotesByLimits(
  current: QuotesByExpiry,
  referenceTs: number | null
): QuotesByExpiry {
  const entries = Object.entries(current);
  if (entries.length <= MAX_TRACKED_EXPIRIES && referenceTs == null) {
    return current;
  }

  const nowTs = referenceTs ?? Date.now();
  const freshest = entries
    .slice()
    .sort(([, left], [, right]) => (right.ts ?? 0) - (left.ts ?? 0));

  const next: QuotesByExpiry = {};
  let kept = 0;
  for (const [expiryKey, quoteState] of freshest) {
    if (kept >= MAX_TRACKED_EXPIRIES) break;
    const quoteTs = quoteState.ts ?? 0;
    if (referenceTs != null && Number.isFinite(quoteTs) && nowTs - quoteTs > STALE_QUOTE_MAX_AGE_MS) {
      continue;
    }
    next[expiryKey] = quoteState;
    kept += 1;
  }

  return next;
}

function downsampleScatter(points: ScatterRow[]) {
  if (points.length <= MAX_RENDER_SCATTER_POINTS) {
    return points;
  }

  const groups = new Map<string, ScatterRow[]>();
  for (const point of points) {
    const key = `${point.exchange ?? "na"}:${point.side}`;
    const bucket = groups.get(key);
    if (bucket) bucket.push(point);
    else groups.set(key, [point]);
  }

  const sampled: ScatterRow[] = [];
  const groupEntries = [...groups.entries()];

  for (let idx = 0; idx < groupEntries.length; idx += 1) {
    const [, groupPoints] = groupEntries[idx];
    const budget = Math.max(
      40,
      Math.floor((groupPoints.length / points.length) * MAX_RENDER_SCATTER_POINTS)
    );
    const take = Math.min(groupPoints.length, budget);

    if (take >= groupPoints.length) {
      sampled.push(...groupPoints);
      continue;
    }

    const stride = (groupPoints.length - 1) / Math.max(1, take - 1);
    for (let sampleIdx = 0; sampleIdx < take; sampleIdx += 1) {
      const pickIndex = Math.round(sampleIdx * stride);
      const point = groupPoints[Math.min(groupPoints.length - 1, pickIndex)];
      sampled.push(point);
    }
  }

  if (sampled.length <= MAX_RENDER_SCATTER_POINTS) {
    return sampled.sort(compareScatterRows);
  }

  const stride = sampled.length / MAX_RENDER_SCATTER_POINTS;
  const clamped: ScatterRow[] = [];
  for (let idx = 0; idx < MAX_RENDER_SCATTER_POINTS; idx += 1) {
    const pickIndex = Math.floor(idx * stride);
    clamped.push(sampled[Math.min(sampled.length - 1, pickIndex)]);
  }

  return clamped.sort(compareScatterRows);
}

function compareCurveRows(a: CurveRow, b: CurveRow) {
  return a.x - b.x;
}

function compareScatterRows(a: ScatterRow, b: ScatterRow) {
  if (a.x !== b.x) return a.x - b.x;
  if (a.y !== b.y) return a.y - b.y;
  if (a.strike !== b.strike) return a.strike - b.strike;
  if (a.level !== b.level) return a.level - b.level;
  return a.side.localeCompare(b.side);
}

type SmileDomainCacheEntry = {
  xDomain: [number, number];
  yDomain: [number, number];
};

const smileDomainCache = new Map<number, SmileDomainCacheEntry>();

function smoothDomainTowards(
  previous: [number, number],
  next: [number, number],
  shrinkBlend: number
): [number, number] {
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
    // If ranges diverge too much, reset immediately.
    return next;
  }

  const min = next[0] < previous[0]
    ? next[0]
    : previous[0] + (next[0] - previous[0]) * shrinkBlend;
  const max = next[1] > previous[1]
    ? next[1]
    : previous[1] + (next[1] - previous[1]) * shrinkBlend;

  return safeDomain(min, max, next);
}

function resolvePointLastTradeIv(point: SmilePoint): number | null {
  // Trade dots should come from explicit trade IV only.
  return resolvePointTradeInfo(point, false).iv;
}

function buildExpiryKeyCandidates(expiry: number) {
  const candidates = new Set<string>([String(expiry)]);
  const normalizedExpiry = safeNumber(expiry);
  if (normalizedExpiry == null) {
    return [...candidates];
  }

  if (Math.abs(normalizedExpiry) < 1e11) {
    // seconds -> milliseconds
    candidates.add(String(Math.round(normalizedExpiry * 1000)));
  } else {
    // milliseconds -> seconds
    candidates.add(String(Math.round(normalizedExpiry / 1000)));
  }

  return [...candidates];
}

function resolveQuoteStateForSmile(smile: SviSmile, quotesByExpiry: QuotesByExpiry) {
  for (const key of buildExpiryKeyCandidates(smile.expiry)) {
    const byKey = quotesByExpiry[key];
    if (byKey) return byKey;
  }

  const targetLabel = typeof smile.label === "string" ? smile.label.trim().toUpperCase() : "";
  if (!targetLabel) return undefined;

  let bestMatch: QuotesByExpiry[string] | undefined;
  for (const quoteState of Object.values(quotesByExpiry)) {
    const quoteLabel = typeof quoteState.label === "string" ? quoteState.label.trim().toUpperCase() : "";
    if (quoteLabel !== targetLabel) continue;
    if (!bestMatch || quoteState.ts > bestMatch.ts) {
      bestMatch = quoteState;
    }
  }

  return bestMatch;
}

function interpolateCurveIv(curveData: CurveRow[], targetX: number) {
  const valid = curveData.filter(
    (point): point is { x: number; y: number } => point.y != null && Number.isFinite(point.y)
  );
  if (valid.length === 0) return null;

  if (targetX <= valid[0].x) return valid[0].y;
  if (targetX >= valid[valid.length - 1].x) return valid[valid.length - 1].y;

  for (let idx = 1; idx < valid.length; idx += 1) {
    const right = valid[idx];
    if (targetX > right.x) continue;

    const left = valid[idx - 1];
    const dx = right.x - left.x;
    if (!Number.isFinite(dx) || dx === 0) return left.y;
    const ratio = (targetX - left.x) / dx;
    return left.y + (right.y - left.y) * ratio;
  }

  return valid[valid.length - 1].y;
}

function resolveBestBidIv(point: SmilePoint) {
  const direct = normalizeIvForChart(point.best_bid_iv);
  if (direct != null) return direct;

  if (!Array.isArray(point.bid_levels) || point.bid_levels.length === 0) {
    return null;
  }

  let best: number | null = null;
  for (const level of point.bid_levels) {
    const candidate = normalizeIvForChart(level.iv);
    if (candidate == null) continue;
    if (best == null || candidate > best) {
      best = candidate;
    }
  }

  return best;
}

function resolveBestAskIv(point: SmilePoint) {
  const direct = normalizeIvForChart(point.best_ask_iv);
  if (direct != null) return direct;

  if (!Array.isArray(point.ask_levels) || point.ask_levels.length === 0) {
    return null;
  }

  let best: number | null = null;
  for (const level of point.ask_levels) {
    const candidate = normalizeIvForChart(level.iv);
    if (candidate == null) continue;
    if (best == null || candidate < best) {
      best = candidate;
    }
  }

  return best;
}

function resolveExchangeBestBidIv(pointByExchange: SmilePointByExchange) {
  const direct = normalizeIvForChart(pointByExchange.best_bid_iv);
  if (direct != null) return direct;

  const bidLevels = Array.isArray(pointByExchange.bid_levels) ? pointByExchange.bid_levels : [];
  if (bidLevels.length === 0) {
    return null;
  }

  let best: number | null = null;
  for (const level of bidLevels) {
    const candidate = normalizeIvForChart(level.iv);
    if (candidate == null) continue;
    if (best == null || candidate > best) {
      best = candidate;
    }
  }

  return best;
}

function resolveExchangeBestAskIv(pointByExchange: SmilePointByExchange) {
  const direct = normalizeIvForChart(pointByExchange.best_ask_iv);
  if (direct != null) return direct;

  const askLevels = Array.isArray(pointByExchange.ask_levels) ? pointByExchange.ask_levels : [];
  if (askLevels.length === 0) {
    return null;
  }

  let best: number | null = null;
  for (const level of askLevels) {
    const candidate = normalizeIvForChart(level.iv);
    if (candidate == null) continue;
    if (best == null || candidate < best) {
      best = candidate;
    }
  }

  return best;
}

function resolvePointBidLevelsForExchange(point: SmilePoint, exchange: string) {
  const pointByExchange = resolvePointByExchange(point, exchange);
  if (pointByExchange && Array.isArray(pointByExchange.bid_levels)) {
    return pointByExchange.bid_levels;
  }
  return point.bid_levels ?? [];
}

function resolvePointAskLevelsForExchange(point: SmilePoint, exchange: string) {
  const pointByExchange = resolvePointByExchange(point, exchange);
  if (pointByExchange && Array.isArray(pointByExchange.ask_levels)) {
    return pointByExchange.ask_levels;
  }
  return point.ask_levels ?? [];
}

function resolvePointBestBidIvForExchange(
  point: SmilePoint,
  exchange: string,
  options?: { fallbackToAggregate?: boolean }
) {
  const fallbackToAggregate = options?.fallbackToAggregate ?? true;
  const pointByExchange = resolvePointByExchange(point, exchange);
  if (pointByExchange) {
    const exchangeBest = resolveExchangeBestBidIv(pointByExchange);
    if (exchangeBest != null) return exchangeBest;
  }
  return fallbackToAggregate ? resolveBestBidIv(point) : null;
}

function resolvePointBestAskIvForExchange(
  point: SmilePoint,
  exchange: string,
  options?: { fallbackToAggregate?: boolean }
) {
  const fallbackToAggregate = options?.fallbackToAggregate ?? true;
  const pointByExchange = resolvePointByExchange(point, exchange);
  if (pointByExchange) {
    const exchangeBest = resolveExchangeBestAskIv(pointByExchange);
    if (exchangeBest != null) return exchangeBest;
  }
  return fallbackToAggregate ? resolveBestAskIv(point) : null;
}

export function buildSmileThroughMatrix(
  snapshot: SviSurfaceSnapshot | null,
  quotesByExpiry: QuotesByExpiry
): SmileThroughMatrix {
  if (!snapshot) {
    return {
      strikes: [],
      rows: [],
      maxThrough: 0,
    };
  }

  const strikeSet = new Set<number>();
  let maxThrough = 0;

  const rows: SmileThroughRow[] = snapshot.smiles.map((smile) => {
    const quoteState = resolveQuoteStateForSmile(smile, quotesByExpiry);
    const quotePoints = quoteState ? Object.values(quoteState.pointsByStrike) : [];
    const curveData = resolveSmileXValues(smile, snapshot)
      .map((x, idx) => ({
        x,
        y: normalizeIvForChart(smile.vol?.[idx]),
      }))
      .sort(compareCurveRows);

    const cellsByStrike: Record<string, SmileThroughCell> = {};
    let activeCount = 0;

    for (const point of quotePoints) {
      const strike = safeNumber(point.strike);
      const x = safeNumber(point.log_moneyness);
      if (strike == null || x == null) continue;

      strikeSet.add(strike);
      const sviIv = interpolateCurveIv(curveData, x);
      if (sviIv == null) continue;

      const bestBidIvDeribit = resolvePointBestBidIvForExchange(point, "deribit");
      const bestAskIvDeribit = resolvePointBestAskIvForExchange(point, "deribit");
      const bestBidIvOkx = resolvePointBestBidIvForExchange(point, "okx", { fallbackToAggregate: false });
      const bestAskIvOkx = resolvePointBestAskIvForExchange(point, "okx", { fallbackToAggregate: false });

      const bidThroughDeribit = bestBidIvDeribit != null ? bestBidIvDeribit - sviIv : 0;
      const askThroughDeribit = bestAskIvDeribit != null ? sviIv - bestAskIvDeribit : 0;
      const bidThroughOkx = bestBidIvOkx != null ? bestBidIvOkx - sviIv : 0;
      const askThroughOkx = bestAskIvOkx != null ? sviIv - bestAskIvOkx : 0;

      const bidThrough = Math.max(0, bidThroughDeribit, bidThroughOkx);
      const askThrough = Math.max(0, askThroughDeribit, askThroughOkx);
      const bestBidIv = bidThroughDeribit >= bidThroughOkx ? bestBidIvDeribit : bestBidIvOkx;
      const bestAskIv = askThroughDeribit >= askThroughOkx ? bestAskIvDeribit : bestAskIvOkx;
      const okxBidThrough = bidThroughOkx > 0;
      const okxAskThrough = askThroughOkx > 0;

      let side: ThroughMatrixSide = "neutral";
      let throughValue = 0;
      if (bidThrough > 0 || askThrough > 0) {
        if (bidThrough >= askThrough) {
          side = "bid";
          throughValue = bidThrough;
        } else {
          side = "ask";
          throughValue = askThrough;
        }
        activeCount += 1;
        if (throughValue > maxThrough) {
          maxThrough = throughValue;
        }
      }

      cellsByStrike[String(strike)] = {
        strike,
        side,
        throughValue,
        sviIv,
        bestBidIv,
        bestAskIv,
        bidThrough: Math.max(0, bidThrough),
        askThrough: Math.max(0, askThrough),
        bestBidIvDeribit,
        bestAskIvDeribit,
        bestBidIvOkx,
        bestAskIvOkx,
        bidThroughDeribit: Math.max(0, bidThroughDeribit),
        askThroughDeribit: Math.max(0, askThroughDeribit),
        bidThroughOkx: Math.max(0, bidThroughOkx),
        askThroughOkx: Math.max(0, askThroughOkx),
        okxBidThrough,
        okxAskThrough,
      };
    }

    return {
      expiry: smile.expiry,
      label: smile.label || formatExpiry(smile.expiry),
      cellsByStrike,
      activeCount,
    };
  });

  const allStrikes = [...strikeSet].sort((a, b) => a - b);
  if (allStrikes.length <= MAX_THROUGH_MATRIX_STRIKES) {
    return {
      strikes: allStrikes,
      rows,
      maxThrough,
    };
  }

  const sampledStrikes = sampleEvenly(allStrikes, MAX_THROUGH_MATRIX_STRIKES);
  const sampledKeys = sampledStrikes.map((strike) => String(strike));
  let sampledMaxThrough = 0;

  const sampledRows = rows.map((row) => {
    const sampledCells: Record<string, SmileThroughCell> = {};
    let activeCount = 0;

    for (const key of sampledKeys) {
      const cell = row.cellsByStrike[key];
      if (!cell) continue;
      sampledCells[key] = cell;

      if (cell.side !== "neutral") {
        activeCount += 1;
        if (cell.throughValue > sampledMaxThrough) {
          sampledMaxThrough = cell.throughValue;
        }
      }
    }

    return {
      ...row,
      cellsByStrike: sampledCells,
      activeCount,
    };
  });

  return {
    strikes: sampledStrikes,
    rows: sampledRows,
    maxThrough: sampledMaxThrough,
  };
}

function sampleEvenly(values: number[], maxPoints: number) {
  if (values.length <= maxPoints) return values;
  if (maxPoints <= 2) return [values[0], values[values.length - 1]];

  const sampled: number[] = [];
  const lastIdx = values.length - 1;

  for (let idx = 0; idx < maxPoints; idx += 1) {
    const sourceIdx = Math.round((idx * lastIdx) / (maxPoints - 1));
    const value = values[sourceIdx];
    if (sampled.length === 0 || sampled[sampled.length - 1] !== value) {
      sampled.push(value);
    }
  }

  if (sampled[0] !== values[0]) sampled.unshift(values[0]);
  if (sampled[sampled.length - 1] !== values[lastIdx]) sampled.push(values[lastIdx]);

  return sampled;
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

function buildSurfaceGridFallbackXValues() {
  const values: number[] = [];
  for (
    let value = SURFACE_GRID_FALLBACK_MIN_X;
    value <= SURFACE_GRID_FALLBACK_MAX_X + 1e-9;
    value += SURFACE_GRID_FALLBACK_STEP
  ) {
    values.push(Number(value.toFixed(6)));
  }
  return values;
}

function interpolateSeriesToGrid(sourceXValues: number[], sourceValues: Array<number | null>, targetXValues: number[]) {
  const validPoints: Array<{ x: number; y: number }> = [];
  for (let idx = 0; idx < Math.min(sourceXValues.length, sourceValues.length); idx += 1) {
    const x = safeNumber(sourceXValues[idx]);
    const y = safeNumber(sourceValues[idx]);
    if (x == null || y == null) continue;
    validPoints.push({ x, y });
  }

  if (validPoints.length === 0) {
    return targetXValues.map(() => null);
  }

  validPoints.sort((left, right) => left.x - right.x);

  if (validPoints.length === 1) {
    return targetXValues.map(() => validPoints[0].y);
  }

  const result: Array<number | null> = [];
  let rightIdx = 1;
  for (const targetX of targetXValues) {
    if (targetX <= validPoints[0].x) {
      result.push(validPoints[0].y);
      continue;
    }
    if (targetX >= validPoints[validPoints.length - 1].x) {
      result.push(validPoints[validPoints.length - 1].y);
      continue;
    }

    while (rightIdx < validPoints.length && targetX > validPoints[rightIdx].x) {
      rightIdx += 1;
    }
    const right = validPoints[Math.min(rightIdx, validPoints.length - 1)];
    const left = validPoints[Math.max(0, rightIdx - 1)];
    const dx = right.x - left.x;
    if (!Number.isFinite(dx) || Math.abs(dx) <= 1e-12) {
      result.push(left.y);
      continue;
    }
    const ratio = (targetX - left.x) / dx;
    result.push(left.y + ((right.y - left.y) * ratio));
  }

  return result;
}

export function buildSurfaceGrid(snapshot: SviSurfaceSnapshot | null): SviSurfaceGrid | null {
  if (!snapshot) return null;

  const existingGrid = snapshot.surface_grid;
  if (
    existingGrid &&
    Array.isArray(existingGrid.x_values) &&
    existingGrid.x_values.length > 0 &&
    Array.isArray(existingGrid.rows) &&
    existingGrid.rows.length > 0
  ) {
    return {
      ...existingGrid,
      rows: [...existingGrid.rows].sort((left, right) => left.expiry - right.expiry),
    };
  }

  const smiles = [...(snapshot.smiles ?? [])].sort((left, right) => left.expiry - right.expiry);
  if (smiles.length === 0) return null;

  const xValues = buildSurfaceGridFallbackXValues();
  const rows = smiles.map((smile) => {
    const smileXValues = resolveSmileXValues(smile, snapshot);
    return {
      expiry: smile.expiry,
      label: smile.label,
      days: safeNumber(smile.days),
      atm: safeNumber(smile.atm),
      atm_version: safeNumber(smile.atm_version),
      var: interpolateSeriesToGrid(smileXValues, smile.var ?? [], xValues),
      vol: interpolateSeriesToGrid(smileXValues, smile.vol ?? [], xValues),
    };
  });

  return {
    x_kind: "log_moneyness",
    x_values: xValues,
    rows,
  };
}

export function buildSmileChartRows(
  snapshot: SviSurfaceSnapshot | null,
  quotesByExpiry: QuotesByExpiry
): SmileChartRow[] {
  if (!snapshot) {
    smileDomainCache.clear();
    return [];
  }

  const activeExpiries = new Set<number>();
  const rows: SmileChartRow[] = snapshot.smiles.map((smile): SmileChartRow => {
    activeExpiries.add(smile.expiry);
    const quoteState = resolveQuoteStateForSmile(smile, quotesByExpiry);
    const quotePoints = quoteState ? Object.values(quoteState.pointsByStrike) : [];
    const smileAtm = safeNumber((smile as { atm?: unknown }).atm) ?? null;

    const rawBidScatter: ScatterRow[] = quotePoints.flatMap((point) => {
      const x = safeNumber(point.log_moneyness);
      if (x == null) return [];

      const bidLevels = resolvePointBidLevelsForExchange(point, "deribit")
        .filter((level) => !isTradeLevel(level));
      if (bidLevels.length > 0) {
        return bidLevels
          .map((level, levelIdx) => {
            const y = normalizeIvForChart(level.iv);
            if (y == null) return null;
            return {
              x,
              y,
              strike: point.strike,
              level: levelIdx,
              side: "bid" as const,
              exchange: "deribit",
              size: level.size,
            };
          })
          .filter(Boolean) as ScatterRow[];
      }

      const bestBidY = resolvePointBestBidIvForExchange(point, "deribit");
      if (bestBidY == null) return [];
      return [
        {
          x,
          y: bestBidY,
          strike: point.strike,
          level: 0,
          side: "bid" as const,
          exchange: "deribit",
          size: null,
        },
      ];
    });

    const rawAskScatter: ScatterRow[] = quotePoints.flatMap((point) => {
      const x = safeNumber(point.log_moneyness);
      if (x == null) return [];

      const askLevels = resolvePointAskLevelsForExchange(point, "deribit")
        .filter((level) => !isTradeLevel(level));
      if (askLevels.length > 0) {
        return askLevels
          .map((level, levelIdx) => {
            const y = normalizeIvForChart(level.iv);
            if (y == null) return null;
            return {
              x,
              y,
              strike: point.strike,
              level: levelIdx,
              side: "ask" as const,
              exchange: "deribit",
              size: level.size,
            };
          })
          .filter(Boolean) as ScatterRow[];
      }

      const bestAskY = resolvePointBestAskIvForExchange(point, "deribit");
      if (bestAskY == null) return [];
      return [
        {
          x,
          y: bestAskY,
          strike: point.strike,
          level: 0,
          side: "ask" as const,
          exchange: "deribit",
          size: null,
        },
      ];
    });

    const rawBestBidScatter: ScatterRow[] = quotePoints.flatMap((point) => {
      const x = safeNumber(point.log_moneyness);
      const y = resolvePointBestBidIvForExchange(point, "deribit");
      if (x == null || y == null) return [];

      return [
        {
          x,
          y,
          strike: point.strike,
          level: 0,
          side: "bid" as const,
          exchange: "deribit",
          size: null,
        },
      ];
    });

    const rawBestAskScatter: ScatterRow[] = quotePoints.flatMap((point) => {
      const x = safeNumber(point.log_moneyness);
      const y = resolvePointBestAskIvForExchange(point, "deribit");
      if (x == null || y == null) return [];

      return [
        {
          x,
          y,
          strike: point.strike,
          level: 0,
          side: "ask" as const,
          exchange: "deribit",
          size: null,
        },
      ];
    });

    const rawOkxScatter: ScatterRow[] = quotePoints.flatMap((point) => {
      const x = safeNumber(point.log_moneyness);
      if (x == null) return [];

      const okxPoint = resolvePointByExchange(point, "okx");
      if (!okxPoint) return [];

      const okxBidLevels = (okxPoint.bid_levels ?? []).filter((level) => !isTradeLevel(level));
      const okxAskLevels = (okxPoint.ask_levels ?? []).filter((level) => !isTradeLevel(level));

      if (okxBidLevels.length > 0 || okxAskLevels.length > 0) {
        const fromBids = okxBidLevels
          .map((level, levelIdx) => {
            const y = normalizeIvForChart(level.iv);
            if (y == null) return null;
            return {
              x,
              y,
              strike: point.strike,
              level: levelIdx,
              side: "bid" as const,
              exchange: "okx",
              size: level.size ?? null,
            };
          })
          .filter(Boolean) as ScatterRow[];
        const fromAsks = okxAskLevels
          .map((level, levelIdx) => {
            const y = normalizeIvForChart(level.iv);
            if (y == null) return null;
            return {
              x,
              y,
              strike: point.strike,
              level: levelIdx,
              side: "ask" as const,
              exchange: "okx",
              size: level.size ?? null,
            };
          })
          .filter(Boolean) as ScatterRow[];
        return [...fromBids, ...fromAsks];
      }

      const bestBidY = resolveExchangeBestBidIv(okxPoint);
      const bestAskY = resolveExchangeBestAskIv(okxPoint);
      const fallback: ScatterRow[] = [];
      if (bestBidY != null) {
        fallback.push({
          x,
          y: bestBidY,
          strike: point.strike,
          level: 0,
          side: "bid" as const,
          exchange: "okx",
          size: null,
        });
      }
      if (bestAskY != null) {
        fallback.push({
          x,
          y: bestAskY,
          strike: point.strike,
          level: 0,
          side: "ask" as const,
          exchange: "okx",
          size: null,
        });
      }

      return fallback;
    });

    const rawLastTradeScatter: ScatterRow[] = quotePoints.flatMap((point) => {
      const x = safeNumber(point.log_moneyness);
      const y = resolvePointLastTradeIv(point);
      if (x == null || y == null) return [];
      const tradeUpdateTs = safeNumber(point.last_trade_update_ts);
      const flashUntilTs = safeNumber(point.last_trade_flash_until_ts);

      return [
        {
          x,
          y,
          strike: point.strike,
          level: 0,
          side: "trade" as const,
          size: null,
          tradeUpdateTs,
          flashUntilTs,
        },
      ];
    });
    const hasDeribit =
      rawBidScatter.length > 0 ||
      rawAskScatter.length > 0 ||
      rawBestBidScatter.length > 0 ||
      rawBestAskScatter.length > 0 ||
      rawLastTradeScatter.length > 0;
    const hasOkx = rawOkxScatter.length > 0;

    const fullCurveData: CurveRow[] = resolveSmileXValues(smile, snapshot)
      .map((x, idx) => ({
        x,
        y: normalizeIvForChart(smile.vol?.[idx]),
      }))
      .sort(compareCurveRows);

    if (fullCurveData.length === 0) {
      return {
        expiry: smile.expiry,
        label: smile.label || formatExpiry(smile.expiry),
        readableExpiry: formatExpiry(smile.expiry, smile.label),
        atm: quoteState?.atm ?? smileAtm,
        lastTradePrice: quoteState?.lastTradePrice ?? null,
        hasDeribit,
        hasOkx,
        curveData: [],
        bidScatter: [],
        askScatter: [],
        okxScatter: [],
        bestBidScatter: [],
        bestAskScatter: [],
        lastTradeScatter: [],
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

    const quoteXs = [
      ...rawBidScatter.map((point) => point.x),
      ...rawAskScatter.map((point) => point.x),
      ...rawOkxScatter.map((point) => point.x),
      ...rawBestBidScatter.map((point) => point.x),
      ...rawBestAskScatter.map((point) => point.x),
      ...rawLastTradeScatter.map((point) => point.x),
    ];

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

    const curveDataWindowed = fullCurveData.filter((point) => point.x >= xMin && point.x <= xMax);
    const curveData = fullCurveData;
    const curveYSource = curveDataWindowed.length > 0 ? curveDataWindowed : fullCurveData;
    const bidScatter = rawBidScatter.filter((point) => point.x >= xMin && point.x <= xMax).sort(compareScatterRows);
    const askScatter = rawAskScatter.filter((point) => point.x >= xMin && point.x <= xMax).sort(compareScatterRows);
    const okxScatter = rawOkxScatter
      .filter((point) => point.x >= xMin && point.x <= xMax)
      .sort(compareScatterRows);
    const bestBidScatter = rawBestBidScatter
      .filter((point) => point.x >= xMin && point.x <= xMax)
      .sort(compareScatterRows);
    const bestAskScatter = rawBestAskScatter
      .filter((point) => point.x >= xMin && point.x <= xMax)
      .sort(compareScatterRows);
    const lastTradeScatter = rawLastTradeScatter
      .filter((point) => point.x >= xMin && point.x <= xMax)
      .sort(compareScatterRows);

    const curveYValues = curveYSource
      .map((point) => point.y)
      .filter((value): value is number => value != null && Number.isFinite(value));
    const curveMinRaw = curveYValues.length ? Math.min(...curveYValues) : 0;
    const curveMaxRaw = curveYValues.length ? Math.max(...curveYValues) : 100;
    const yPad = Math.max((curveMaxRaw - curveMinRaw) * 0.15, 2);
    const yMin = snapDown(Math.max(0, curveMinRaw - yPad), 5);
    const yMax = snapUp(curveMaxRaw + yPad, 5);

    const renderedBidScatter = downsampleScatter(bidScatter);
    const renderedAskScatter = downsampleScatter(askScatter);
    const renderedOkxScatter = downsampleScatter(okxScatter);

    const visibleSizes = [...renderedBidScatter, ...renderedAskScatter, ...renderedOkxScatter]
      .map((point) => point.size)
      .filter((size): size is number => size != null && Number.isFinite(size) && size > 0);

    const rawXDomain = safeDomain(xMin, xMax, [-1, 1]);
    const rawYDomain = safeDomain(yMin, yMax, [0, 100]);
    const cachedDomains = smileDomainCache.get(smile.expiry);

    const smoothedXDomain = cachedDomains
      ? smoothDomainTowards(cachedDomains.xDomain, rawXDomain, 0.18)
      : rawXDomain;
    const smoothedYDomain = cachedDomains
      ? smoothDomainTowards(cachedDomains.yDomain, rawYDomain, 0.14)
      : rawYDomain;

    const xDomain = safeDomain(
      snapDown(smoothedXDomain[0], 0.05),
      snapUp(smoothedXDomain[1], 0.05),
      rawXDomain
    );
    const yDomain = safeDomain(
      snapDown(Math.max(0, smoothedYDomain[0]), 5),
      snapUp(smoothedYDomain[1], 5),
      rawYDomain
    );
    smileDomainCache.set(smile.expiry, { xDomain, yDomain });

    const xTickStep = chooseTickStep(xDomain[1] - xDomain[0], [0.05, 0.1, 0.2, 0.25, 0.5, 1], 6);
    const yTickStep = chooseTickStep(yDomain[1] - yDomain[0], [5, 10, 15, 20, 25, 50], 6);

    const atmPoint = curveData.reduce<CurveRow | null>((best, current) => {
      if (!best) return current;
      return Math.abs(current.x) < Math.abs(best.x) ? current : best;
    }, null);
    const lastTradePrice = quoteState?.lastTradePrice ?? null;

    return {
      expiry: smile.expiry,
      label: smile.label || formatExpiry(smile.expiry),
      readableExpiry: formatExpiry(smile.expiry, smile.label),
      atm: quoteState?.atm ?? smileAtm,
      lastTradePrice,
      hasDeribit,
      hasOkx,
      curveData,
      bidScatter: renderedBidScatter,
      askScatter: renderedAskScatter,
      okxScatter: renderedOkxScatter,
      bestBidScatter,
      bestAskScatter,
      lastTradeScatter,
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

  for (const expiry of [...smileDomainCache.keys()]) {
    if (!activeExpiries.has(expiry)) {
      smileDomainCache.delete(expiry);
    }
  }

  return rows;
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
