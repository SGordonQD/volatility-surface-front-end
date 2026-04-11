import { useCallback, useEffect, useEffectEvent, useRef, useState } from "react";

import {
  applySmilePointUpdate,
  applySmileSnapshot,
  FALLBACK_WS_URL,
  pruneQuotesBySnapshot,
  RECONNECT_DELAYS_MS,
  safeNumber,
} from "../lib/svi-charting";
import type {
  IncomingMessage,
  QuotesByExpiry,
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
  lastSnapshotUpdated: number | null;
  quotesByExpiry: QuotesByExpiry;
  reconnectAttempt: number;
  snapshot: SviSurfaceSnapshot | null;
  statusText: string;
};

function isStatusMessage(message: IncomingMessage): message is StatusMessage {
  return message.type === "status" && typeof message.message === "string";
}

function isSurfaceFitStatusMessage(message: IncomingMessage): message is SurfaceFitStatusMessage {
  return message.type === "surface_fit_status";
}

function isSurfaceSnapshot(message: IncomingMessage): message is SviSurfaceSnapshot {
  return message.type === "svi_surface_snapshot";
}

function isSmileSnapshotMessage(message: IncomingMessage): message is SmileSnapshotMessage {
  return message.type === "smile_snapshot";
}

function isSmilePointUpdateMessage(message: IncomingMessage): message is SmilePointUpdateMessage {
  return message.type === "smile_point_update";
}

export function useSviFeed(): FeedState {
  const [connected, setConnected] = useState(false);
  const [currentFitError, setCurrentFitError] = useState<number | null>(null);
  const [lastFitError, setLastFitError] = useState<number | null>(null);
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
    let latestFitStatus: SurfaceFitStatusMessage | null = null;
    let latestStatus: string | null = null;
    let latestTs: number | null = null;
    const smileSnapshots: SmileSnapshotMessage[] = [];
    const smilePointUpdates: SmilePointUpdateMessage[] = [];

    for (const message of messages) {
      if (isStatusMessage(message)) {
        latestStatus = message.message;
        continue;
      }

      if (isSurfaceFitStatusMessage(message)) {
        latestFitStatus = message;
        continue;
      }

      if (isSurfaceSnapshot(message)) {
        latestSnapshot = message;
        latestTs = message.ts ?? Date.now();
        continue;
      }

      if (isSmileSnapshotMessage(message)) {
        smileSnapshots.push(message);
        latestTs = message.ts ?? Date.now();
        continue;
      }

      if (isSmilePointUpdateMessage(message)) {
        smilePointUpdates.push(message);
        latestTs = message.ts ?? Date.now();
      }
    }

    if (latestStatus) {
      setStatusText(latestStatus);
    }

    if (latestFitStatus) {
      setLastFitError(safeNumber(latestFitStatus.fit?.last_fit_error));
      setCurrentFitError(safeNumber(latestFitStatus.live?.current_error));
    }

    if (latestSnapshot) {
      setSnapshot((current) => {
        if (current && latestSnapshot && latestSnapshot.ts < current.ts) {
          return current;
        }
        return latestSnapshot;
      });

      setLastSnapshotUpdated((current) => {
        if (current != null && latestTs != null && latestTs < current) {
          return current;
        }
        return latestTs;
      });

      setStatusText(`Received ${latestSnapshot.smiles.length} smiles`);
      setQuotesByExpiry((current) => pruneQuotesBySnapshot(current, latestSnapshot));
    }

    if (smileSnapshots.length > 0 || smilePointUpdates.length > 0) {
      setQuotesByExpiry((current) => {
        let next = current;

        for (const message of smileSnapshots) {
          next = applySmileSnapshot(next, message);
        }

        for (const message of smilePointUpdates) {
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
  }, [clearReconnectTimer, connect, resetReconnectState]);

  return {
    connected,
    currentFitError,
    lastFitError,
    lastSnapshotUpdated,
    quotesByExpiry,
    reconnectAttempt,
    snapshot,
    statusText,
  };
}
