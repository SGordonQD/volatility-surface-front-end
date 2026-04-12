import { useCallback, useEffect, useEffectEvent, useRef, useState } from "react";

import {
  applySmileLevelsSnapshot,
  applySmilePointUpdate,
  applySmileSnapshot,
  FALLBACK_WS_URL,
  RECONNECT_DELAYS_MS,
  safeNumber,
} from "../lib/svi-charting";
import type {
  IncomingMessage,
  QuotesByExpiry,
  SmileLevelsPatchMessage,
  SmileLevelsSnapshotMessage,
  SmilePointUpdateMessage,
  SmileSnapshotMessage,
  StatusMessage,
  SurfaceFitStatusMessage,
  SviSurfaceSnapshot,
} from "../lib/svi-types";

type FeedState = {
  connected: boolean;
  currentFitError: number | null;
  lastFitError: number | null;
  lastFitElapsedSeconds: number | null;
  lastSnapshotUpdated: number | null;
  quotesByExpiry: QuotesByExpiry;
  reconnectAttempt: number;
  snapshot: SviSurfaceSnapshot | null;
  statusText: string;
};

const TARGET_DEBUG_CCY = "BTC";
const TARGET_DEBUG_EXPIRY_LABEL = "29MAY26";

function extractTargetSmileDebug(
  message:
    | SmileLevelsSnapshotMessage
    | SmileLevelsPatchMessage
    | SmileSnapshotMessage
    | SmilePointUpdateMessage
) {
  const ccy = typeof message.ccy === "string" ? message.ccy.toUpperCase() : "";
  const label = typeof message.label === "string" ? message.label.toUpperCase() : "";
  const pointWithTargetTicker = (message.points ?? []).find((point) => {
    const levels = [...(point.bid_levels ?? []), ...(point.ask_levels ?? [])];
    return levels.some((level) => typeof level.ticker === "string" && level.ticker.includes("BTC-29MAY26"));
  });

  const isTarget = ccy === TARGET_DEBUG_CCY && (
    label.includes(TARGET_DEBUG_EXPIRY_LABEL) || Boolean(pointWithTargetTicker)
  );
  if (!isTarget) return null;

  const samplePoint = pointWithTargetTicker ?? message.points?.[0];
  const messageRecord = message as unknown as Record<string, unknown>;
  const upserts = Array.isArray(messageRecord.upserts)
    ? (messageRecord.upserts as Array<Record<string, unknown>>)
    : [];
  const tradeLikeUpserts = upserts.filter((upsert) => {
    const side = typeof upsert.side === "string" ? upsert.side.toLowerCase() : "";
    if (side === "trade" || side === "last_trade" || side === "last" || side === "fill") {
      return true;
    }

    if (
      typeof upsert.last_trade_iv === "number" ||
      typeof upsert.last_trade_price === "number" ||
      typeof upsert.trade_iv === "number" ||
      typeof upsert.trade_price === "number" ||
      upsert.is_trade === true
    ) {
      return true;
    }

    const id = typeof upsert.id === "string" ? upsert.id.toLowerCase() : "";
    return id.includes(":trade:") || id.includes(":last:");
  });
  const hasAtm = "atm" in message;
  const hasSmileAtm = "smile_atm" in message;
  const hasAtmVersion = "atm_version" in message;
  const hasLastTradePrice = "last_trade_price" in message;
  const underlyingLastTradePrice =
    "underlying" in message ? message.underlying?.last_trade_price ?? null : null;
  const underlyingSmileAtm =
    "underlying" in message ? message.underlying?.smile_atm ?? null : null;

  return {
    type: message.type,
    ts: message.ts,
    ccy: message.ccy,
    expiry: message.expiry,
    label: message.label ?? null,
    atm:
      hasAtm
        ? message.atm ?? null
        : (hasSmileAtm ? message.smile_atm ?? null : underlyingSmileAtm),
    atmVersion: hasAtmVersion ? message.atm_version ?? null : null,
    lastTradePrice: hasLastTradePrice ? message.last_trade_price ?? null : underlyingLastTradePrice,
    pointCount: message.points?.length ?? 0,
    upsertCount: upserts.length,
    tradeLikeUpsertCount: tradeLikeUpserts.length,
    samplePoint: samplePoint
      ? {
          strike: samplePoint.strike,
          logMoneyness: samplePoint.log_moneyness,
          bestBidIv: samplePoint.best_bid_iv ?? null,
          bestAskIv: samplePoint.best_ask_iv ?? null,
          lastTradeIv: (samplePoint as Record<string, unknown>).last_trade_iv ?? null,
          lastTradePrice: (samplePoint as Record<string, unknown>).last_trade_price ?? null,
          lastTrades:
            Array.isArray((samplePoint as Record<string, unknown>).last_trades)
              ? ((samplePoint as Record<string, unknown>).last_trades as unknown[]).length
              : 0,
          tradeLevels:
            Array.isArray((samplePoint as Record<string, unknown>).last_trade_levels)
              ? ((samplePoint as Record<string, unknown>).last_trade_levels as unknown[]).length
              : 0,
          bidLevels: samplePoint.bid_levels?.length ?? 0,
          askLevels: samplePoint.ask_levels?.length ?? 0,
        }
      : null,
  };
}

function isStatusMessage(message: IncomingMessage): message is StatusMessage {
  return message.type === "status" && typeof message.message === "string";
}

function isSurfaceFitStatusMessage(message: IncomingMessage): message is SurfaceFitStatusMessage {
  return resolveFitEnvelope(message) != null;
}

function isSurfaceSnapshot(message: IncomingMessage): message is SviSurfaceSnapshot {
  return message.type === "svi_surface_snapshot";
}

function isSmileSnapshotMessage(message: IncomingMessage): message is SmileSnapshotMessage {
  return message.type === "smile_snapshot";
}

function isSmileLevelsSnapshotMessage(message: IncomingMessage): message is SmileLevelsSnapshotMessage {
  return message.type === "smile_levels_snapshot";
}

function isSmileLevelsPatchMessage(message: IncomingMessage): message is SmileLevelsPatchMessage {
  return message.type === "smile_levels_patch";
}

function isSmilePointUpdateMessage(message: IncomingMessage): message is SmilePointUpdateMessage {
  return message.type === "smile_point_update";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function hasFitLikeShape(record: Record<string, unknown>) {
  const fit = asRecord(record.fit);
  const live = asRecord(record.live);

  const hasFitShape =
    fit != null &&
    (asRecord(fit.current_fit) != null ||
      asRecord(fit.last_fit) != null ||
      "last_fit_error" in fit ||
      "last_fit_elapsed_seconds" in fit);

  const hasLiveShape =
    live != null &&
    ("current_error" in live || "error_per_point" in live || "total_points" in live);

  return hasFitShape || hasLiveShape;
}

function resolveFitEnvelope(message: IncomingMessage): Record<string, unknown> | null {
  const root = asRecord(message);
  if (!root) return null;

  const candidates = [
    root,
    asRecord(root.payload),
    asRecord(root.data),
    asRecord(root.message),
  ].filter((candidate): candidate is Record<string, unknown> => candidate != null);

  for (const candidate of candidates) {
    const type = typeof candidate.type === "string" ? candidate.type.toLowerCase() : "";
    if (type === "surface_fit_status" || type === "fit_status" || type === "surface-fit-status") {
      return candidate;
    }
  }

  for (const candidate of candidates) {
    if (hasFitLikeShape(candidate)) {
      return candidate;
    }
  }

  return null;
}

function resolveFitMetrics(message: IncomingMessage): {
  currentFitError: number | null;
  lastFitError: number | null;
  elapsedSeconds: number | null;
} {
  const root = resolveFitEnvelope(message) ?? asRecord(message) ?? {};
  const fit = asRecord(root.fit) ?? {};
  const live = asRecord(root.live) ?? {};

  const currentFit =
    asRecord(fit.current_fit) ??
    asRecord(root.current_fit) ??
    {};
  const lastFit =
    asRecord(fit.last_fit) ??
    asRecord(root.last_fit) ??
    {};

  const currentFitError =
    safeNumber(currentFit.fun) ??
    safeNumber(currentFit.error) ??
    safeNumber(fit.current_fit_error) ??
    safeNumber(root.current_fit_error) ??
    safeNumber(live.current_error);

  const lastFitError =
    safeNumber(lastFit.fun) ??
    safeNumber(lastFit.error) ??
    safeNumber(fit.last_fit_error) ??
    safeNumber(root.last_fit_error);

  const elapsedSeconds =
    safeNumber(currentFit.elapsed_seconds) ??
    safeNumber(currentFit.elapsed) ??
    safeNumber(lastFit.elapsed_seconds) ??
    safeNumber(lastFit.elapsed) ??
    safeNumber(fit.last_fit_elapsed_seconds) ??
    safeNumber(root.last_fit_elapsed_seconds) ??
    safeNumber(root.elapsed_seconds) ??
    safeNumber(root.fit_elapsed_seconds);

  return {
    currentFitError,
    lastFitError,
    elapsedSeconds,
  };
}

export function useSviFeed(): FeedState {
  const [connected, setConnected] = useState(false);
  const [currentFitError, setCurrentFitError] = useState<number | null>(null);
  const [lastFitError, setLastFitError] = useState<number | null>(null);
  const [lastFitElapsedSeconds, setLastFitElapsedSeconds] = useState<number | null>(null);
  const [lastSnapshotUpdated, setLastSnapshotUpdated] = useState<number | null>(null);
  const [quotesByExpiry, setQuotesByExpiry] = useState<QuotesByExpiry>({});
  const [reconnectAttempt, setReconnectAttempt] = useState(0);
  const [snapshot, setSnapshot] = useState<SviSurfaceSnapshot | null>(null);
  const [statusText, setStatusText] = useState("Waiting for websocket data...");

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<number | null>(null);
  const shouldReconnectRef = useRef(true);
  const reconnectAttemptRef = useRef(0);
  const manuallyClosingRef = useRef(false);
  const pendingMessagesRef = useRef<IncomingMessage[]>([]);
  const flushScheduledRef = useRef(false);
  const targetDebugLastLogAtRef = useRef(0);

  const clearReconnectTimer = useCallback(() => {
    if (reconnectTimeoutRef.current !== null) {
      window.clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
  }, []);

  const resetReconnectState = useCallback(() => {
    reconnectAttemptRef.current = 0;
    setReconnectAttempt(0);
  }, []);

  const getReconnectDelay = useCallback((attempt: number) => {
    return RECONNECT_DELAYS_MS[Math.min(attempt, RECONNECT_DELAYS_MS.length - 1)];
  }, []);

  const flushPendingMessages = useEffectEvent(() => {
    flushScheduledRef.current = false;

    const messages = pendingMessagesRef.current;
    pendingMessagesRef.current = [];

    if (messages.length === 0) return;

    let latestSnapshot: SviSurfaceSnapshot | null = null;
    let latestCurrentFitError: number | undefined;
    let latestLastFitError: number | undefined;
    let latestElapsedSeconds: number | undefined;
    let latestStatus: string | null = null;
    const orderedSmileMessages: Array<
      | SmileLevelsSnapshotMessage
      | SmileLevelsPatchMessage
      | SmileSnapshotMessage
      | SmilePointUpdateMessage
    > = [];
    let latestTargetDebugPayload: ReturnType<typeof extractTargetSmileDebug> = null;

    for (const message of messages) {
      if (isStatusMessage(message)) {
        latestStatus = message.message;
        continue;
      }

      if (isSurfaceFitStatusMessage(message)) {
        const nextMetrics = resolveFitMetrics(message);
        if (nextMetrics.currentFitError != null) {
          latestCurrentFitError = nextMetrics.currentFitError;
        }
        if (nextMetrics.lastFitError != null) {
          latestLastFitError = nextMetrics.lastFitError;
        }
        if (nextMetrics.elapsedSeconds != null) {
          latestElapsedSeconds = nextMetrics.elapsedSeconds;
        }
        continue;
      }

      if (isSurfaceSnapshot(message)) {
        latestSnapshot = message;
        continue;
      }

      if (isSmileSnapshotMessage(message)) {
        orderedSmileMessages.push(message);
        const targetDebugPayload = extractTargetSmileDebug(message);
        if (targetDebugPayload) {
          latestTargetDebugPayload = targetDebugPayload;
        }
        continue;
      }

      if (isSmileLevelsSnapshotMessage(message)) {
        orderedSmileMessages.push(message);
        const targetDebugPayload = extractTargetSmileDebug(message);
        if (targetDebugPayload) {
          latestTargetDebugPayload = targetDebugPayload;
        }
        continue;
      }

      if (isSmileLevelsPatchMessage(message)) {
        orderedSmileMessages.push(message);
        const targetDebugPayload = extractTargetSmileDebug(message);
        if (targetDebugPayload) {
          latestTargetDebugPayload = targetDebugPayload;
        }
        continue;
      }

      if (isSmilePointUpdateMessage(message)) {
        orderedSmileMessages.push(message);
        const targetDebugPayload = extractTargetSmileDebug(message);
        if (targetDebugPayload) {
          latestTargetDebugPayload = targetDebugPayload;
        }
      }
    }

    if (latestTargetDebugPayload) {
      const now = performance.now();
      if (now - targetDebugLastLogAtRef.current > 750) {
        targetDebugLastLogAtRef.current = now;
        console.info("[svi-debug] BTC-29MAY26 update", latestTargetDebugPayload);
      }
    }

    if (latestStatus) {
      setStatusText(latestStatus);
    }

    if (latestCurrentFitError != null) {
      setCurrentFitError(latestCurrentFitError);
    }
    if (latestLastFitError != null) {
      setLastFitError(latestLastFitError);
    }
    if (latestElapsedSeconds != null) {
      setLastFitElapsedSeconds(latestElapsedSeconds);
    }

    if (latestSnapshot) {
      setSnapshot(latestSnapshot);

      setLastSnapshotUpdated((current) => {
        const nextTs = latestSnapshot?.ts ?? null;
        if (current != null && nextTs != null && nextTs < current) {
          return current;
        }
        return nextTs;
      });

      setStatusText(`Received ${latestSnapshot.smiles.length} smiles`);
    }

    if (orderedSmileMessages.length > 0) {
      setQuotesByExpiry((current) => {
        let next = current;

        for (const message of orderedSmileMessages) {
          if (isSmileLevelsSnapshotMessage(message) || isSmileLevelsPatchMessage(message)) {
            next = applySmileLevelsSnapshot(next, message);
            continue;
          }
          if (isSmileSnapshotMessage(message)) {
            next = applySmileSnapshot(next, message);
            continue;
          }
          next = applySmilePointUpdate(next, message);
        }

        return next;
      });
    }
  });

  const connect = useEffectEvent(() => {
    clearReconnectTimer();
    manuallyClosingRef.current = false;

    if (wsRef.current) {
      wsRef.current.onopen = null;
      wsRef.current.onclose = null;
      wsRef.current.onerror = null;
      wsRef.current.onmessage = null;
      wsRef.current.close();
      wsRef.current = null;
    }

    const ws = new WebSocket(FALLBACK_WS_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      resetReconnectState();
      setStatusText("Connected");
    };

    ws.onclose = () => {
      setConnected(false);
      wsRef.current = null;

      if (!shouldReconnectRef.current || manuallyClosingRef.current) {
        setStatusText("Disconnected");
        return;
      }

      const currentAttempt = reconnectAttemptRef.current;
      const delay = getReconnectDelay(currentAttempt);

      setReconnectAttempt(currentAttempt + 1);
      setStatusText(`Disconnected - reconnecting in ${Math.round(delay / 1000)}s`);

      if (reconnectTimeoutRef.current === null) {
        reconnectTimeoutRef.current = window.setTimeout(() => {
          reconnectTimeoutRef.current = null;
          reconnectAttemptRef.current = currentAttempt + 1;
          connect();
        }, delay);
      }
    };

    ws.onerror = () => {
      setConnected(false);

      if (!shouldReconnectRef.current || manuallyClosingRef.current) {
        setStatusText("WebSocket error");
        return;
      }

      const currentAttempt = reconnectAttemptRef.current;
      const delay = getReconnectDelay(currentAttempt);
      setStatusText(`WebSocket error - retrying in ${Math.round(delay / 1000)}s`);
    };

    ws.onmessage = (event) => {
      try {
        const message: IncomingMessage = JSON.parse(event.data);
        pendingMessagesRef.current.push(message);

        if (!flushScheduledRef.current) {
          flushScheduledRef.current = true;
          requestAnimationFrame(() => flushPendingMessages());
        }
      } catch (error) {
        console.error("Failed to parse websocket message", error);
        setStatusText("Received invalid message");
      }
    };
  });

  useEffect(() => {
    shouldReconnectRef.current = true;
    resetReconnectState();
    connect();

    return () => {
      shouldReconnectRef.current = false;
      manuallyClosingRef.current = true;
      clearReconnectTimer();

      pendingMessagesRef.current = [];
      flushScheduledRef.current = false;

      if (wsRef.current) {
        wsRef.current.onopen = null;
        wsRef.current.onclose = null;
        wsRef.current.onerror = null;
        wsRef.current.onmessage = null;
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [clearReconnectTimer, resetReconnectState]);

  return {
    connected,
    currentFitError,
    lastFitError,
    lastFitElapsedSeconds,
    lastSnapshotUpdated,
    quotesByExpiry,
    reconnectAttempt,
    snapshot,
    statusText,
  };
}
