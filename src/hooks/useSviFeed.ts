import { useCallback, useEffect, useEffectEvent, useRef, useState } from "react";

import {
  applySmileLevelsSnapshot,
  applySmilePointUpdate,
  applySmileSnapshot,
  FALLBACK_WS_URL,
  pruneQuotesByLimits,
  pruneQuotesBySnapshot,
  RECONNECT_DELAYS_MS,
  safeNumber,
} from "../lib/svi-charting";
import type {
  AtmMessage,
  FlyByExpiry,
  IncomingMessage,
  QuotesByExpiry,
  RiskReversalByExpiry,
  RiskReversalNode,
  RiskReversalUpdateMessage,
  SmileLevelsAddMessage,
  SmileLevelsPatchMessage,
  SmileLevelsRemoveMessage,
  SmileLevelsSnapshotMessage,
  SmilePointUpdateMessage,
  SviFlyPatchMessage,
  SviFlySmile,
  SviSmile,
  SviTenorPatchMessage,
  SviTenorRow,
  SviTenorSnapshotMessage,
  TenorByKey,
  TenorState,
  SviSurfacePatch,
  SviSurfacePatchSmile,
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
  riskReversalByExpiry: RiskReversalByExpiry;
  flyByExpiry: FlyByExpiry;
  tenorByKey: TenorByKey;
  snapshot: SviSurfaceSnapshot | null;
  statusText: string;
};

const MAX_PENDING_MESSAGES = 6000;
const TARGET_PENDING_MESSAGES = 3000;
const MAX_MESSAGES_PER_FLUSH = 900;
const DEBUG_SAMPLE_INTERVAL_MS = 5000;

function isSviDebugEnabled() {
  if (typeof window === "undefined") return false;
  try {
    const queryFlag = new URLSearchParams(window.location.search).get("sviDebug");
    if (queryFlag === "1" || queryFlag?.toLowerCase() === "true") return true;
    const storedFlag = window.localStorage.getItem("SVI_DEBUG");
    return storedFlag === "1" || storedFlag?.toLowerCase() === "true";
  } catch {
    return false;
  }
}

function isStatusMessage(message: IncomingMessage): message is StatusMessage {
  const record = asRecord(message);
  return record?.type === "status" && typeof record.message === "string";
}

function isSurfaceFitStatusMessage(message: IncomingMessage): message is SurfaceFitStatusMessage {
  return resolveFitEnvelope(message) != null;
}

function isSurfaceSnapshot(message: IncomingMessage): message is SviSurfaceSnapshot {
  if (message.type !== "svi_surface_snapshot") return false;
  const schemaVersion = safeNumber((message as Record<string, unknown>).schemaVersion);
  return schemaVersion == null || schemaVersion === 1;
}

function isSurfacePatch(message: IncomingMessage): message is SviSurfacePatch {
  if (message.type !== "svi_surface_patch") return false;
  const schemaVersion = safeNumber((message as Record<string, unknown>).schemaVersion);
  return schemaVersion == null || schemaVersion === 1;
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

function isSmileLevelsAddMessage(message: IncomingMessage): message is SmileLevelsAddMessage {
  return message.type === "smile_levels_add";
}

function isSmileLevelsRemoveMessage(message: IncomingMessage): message is SmileLevelsRemoveMessage {
  return message.type === "smile_levels_remove";
}

function isSmilePointUpdateMessage(message: IncomingMessage): message is SmilePointUpdateMessage {
  return message.type === "smile_point_update";
}

function isAtmMessage(message: IncomingMessage): message is AtmMessage {
  const record = asRecord(message);
  if (!record) return false;
  const type = typeof record.type === "string" ? record.type : undefined;
  const eventType = typeof record.event_type === "string" ? record.event_type : undefined;
  return type === "atm" || eventType === "atm";
}

function isSviFlyPatchMessage(message: IncomingMessage): message is SviFlyPatchMessage {
  return normalizeSviFlyPatchMessage(message) != null;
}

function isSviTenorSnapshotMessage(message: IncomingMessage): message is SviTenorSnapshotMessage {
  return message.type === "svi_tenor_snapshot";
}

function isSviTenorPatchMessage(message: IncomingMessage): message is SviTenorPatchMessage {
  return message.type === "svi_tenor_patch";
}

function normalizeRiskReversalNode(rawNode: unknown, fallbackLabel: string): RiskReversalNode | null {
  const node = asRecord(rawNode);
  if (!node) return null;

  const label =
    (typeof node.label === "string" && node.label.trim()) ||
    fallbackLabel;
  if (!label) return null;

  const normalized: RiskReversalNode = {
    label,
  };

  if (typeof node.option_type === "string") normalized.option_type = node.option_type;

  const targetDelta = safeNumber(node.target_delta);
  if (targetDelta != null) normalized.target_delta = targetDelta;

  const delta = safeNumber(node.delta);
  if (delta != null) normalized.delta = delta;

  const deltaError = safeNumber(node.delta_error);
  if (deltaError != null) normalized.delta_error = deltaError;

  const logMoneyness = safeNumber(node.log_moneyness);
  if (logMoneyness != null) normalized.log_moneyness = logMoneyness;

  const strike = safeNumber(node.strike);
  if (strike != null) normalized.strike = strike;

  const vol = safeNumber(node.vol);
  if (vol != null) normalized.vol = vol;

  return normalized;
}

function normalizeRiskNodeMap(rawNodes: unknown) {
  const nodeRecord = asRecord(rawNodes);
  if (!nodeRecord) return {} as Record<string, RiskReversalNode>;

  const nodes: Record<string, RiskReversalNode> = {};
  for (const [key, value] of Object.entries(nodeRecord)) {
    const normalizedNode = normalizeRiskReversalNode(value, key);
    if (!normalizedNode) continue;
    const nodeKey = (typeof key === "string" && key.trim()) || normalizedNode.label;
    nodes[nodeKey] = normalizedNode;
  }
  return nodes;
}

function normalizeRiskNodeArray(rawNodes: unknown) {
  if (!Array.isArray(rawNodes)) return {} as Record<string, RiskReversalNode>;

  const nodes: Record<string, RiskReversalNode> = {};
  for (const item of rawNodes) {
    const record = asRecord(item);
    if (!record) continue;
    const key =
      (typeof record.key === "string" && record.key.trim()) ||
      (typeof record.label === "string" && record.label.trim()) ||
      "";
    if (!key) continue;
    const normalizedNode = normalizeRiskReversalNode(record, key);
    if (!normalizedNode) continue;
    nodes[key] = normalizedNode;
  }
  return nodes;
}

function normalizeRiskReversalUpdateMessage(message: IncomingMessage): RiskReversalUpdateMessage | null {
  const root = asRecord(message);
  if (!root) return null;

  return normalizeRiskReversalUpdatePayload(root);
}

function normalizeRiskReversalUpdatePayload(
  root: Record<string, unknown>,
  fallbackTs?: number,
  fallbackCcy?: string,
  fallbackType?: string
): RiskReversalUpdateMessage | null {
  const expiry = safeNumber(root.expiry);
  if (expiry == null) return null;

  const nodes = {
    ...normalizeRiskNodeMap(root.risk_reversal_nodes),
    ...normalizeRiskNodeMap(root.nodes),
    ...normalizeRiskNodeArray(root.risk_reversal_node_points),
  };

  const rawRr = asRecord(root.risk_reversals) ?? asRecord(root.rr);
  const riskReversals: Record<string, number | null | undefined> = {};
  if (rawRr) {
    for (const [key, value] of Object.entries(rawRr)) {
      const numeric = safeNumber(value);
      riskReversals[key] = numeric;
    }
  }
  const hasNodePayload = Object.keys(nodes).length > 0;
  const hasRiskReversalPayload = Object.keys(riskReversals).length > 0;
  if (!hasNodePayload && !hasRiskReversalPayload) return null;

  return {
    type: typeof root.type === "string" ? root.type : fallbackType,
    ts: safeNumber(root.ts) ?? fallbackTs ?? undefined,
    ccy: typeof root.ccy === "string" ? root.ccy : fallbackCcy,
    expiry,
    label: typeof root.label === "string" ? root.label : undefined,
    days: safeNumber(root.days) ?? undefined,
    risk_reversal_nodes: hasNodePayload ? nodes : {},
    risk_reversals: Object.keys(riskReversals).length > 0 ? riskReversals : undefined,
  };
}

function normalizeRiskReversalUpdateMessages(message: IncomingMessage): RiskReversalUpdateMessage[] {
  const root = asRecord(message);
  if (!root) return [];

  const candidates = [
    root,
    asRecord(root.payload),
    asRecord(root.data),
    asRecord(root.message),
  ].filter((candidate): candidate is Record<string, unknown> => candidate != null);

  for (const candidate of candidates) {
    const type = typeof candidate.type === "string" ? candidate.type.toLowerCase() : "";
    if (type.includes("fly")) continue;
    const normalizedSingle = normalizeRiskReversalUpdatePayload(candidate);
    if (normalizedSingle) return [normalizedSingle];
  }

  for (const candidate of candidates) {
    const type = typeof candidate.type === "string" ? candidate.type.toLowerCase() : "";
    if (type.includes("fly")) continue;
    if (!Array.isArray(candidate.smiles)) continue;

    const fallbackTs = safeNumber(candidate.ts);
    const fallbackCcy = typeof candidate.ccy === "string" ? candidate.ccy : undefined;
    const fallbackType = typeof candidate.type === "string" ? candidate.type : "risk_reversal_patch";

    const parsed = candidate.smiles
      .map((rawSmile) => {
        const smile = asRecord(rawSmile);
        if (!smile) return null;
        return normalizeRiskReversalUpdatePayload(smile, fallbackTs ?? undefined, fallbackCcy, fallbackType);
      })
      .filter((item): item is RiskReversalUpdateMessage => item != null);
    if (parsed.length > 0) return parsed;
  }

  return [];
}

function normalizeSviFlySmile(rawSmile: unknown): SviFlySmile | null {
  const smile = asRecord(rawSmile);
  if (!smile) return null;

  const expiry = safeNumber(smile.expiry);
  if (expiry == null) return null;

  const rawFlies = asRecord(smile.flies);
  const flies: Record<string, number | null | undefined> = {};
  if (rawFlies) {
    for (const [key, value] of Object.entries(rawFlies)) {
      if (!key.trim()) continue;
      flies[key] = safeNumber(value);
    }
  }

  const nodes = {
    ...normalizeRiskNodeMap(smile.nodes),
    ...normalizeRiskNodeArray(smile.fly_node_points),
  };

  return {
    expiry,
    label: typeof smile.label === "string" ? smile.label : undefined,
    days: safeNumber(smile.days) ?? undefined,
    atm: safeNumber(smile.atm),
    atm_version: safeNumber(smile.atm_version),
    flies: Object.keys(flies).length > 0 ? flies : undefined,
    nodes: Object.keys(nodes).length > 0 ? nodes : undefined,
  };
}

function normalizeSviFlyPatchMessage(message: IncomingMessage): SviFlyPatchMessage | null {
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
    const smiles = Array.isArray(candidate.smiles) ? candidate.smiles : [];
    const looksLikeFly =
      type === "svi_fly_patch" ||
      type === "fly_patch" ||
      smiles.some((rawSmile) => {
        const smile = asRecord(rawSmile);
        return (
          smile != null &&
          (asRecord(smile.flies) != null ||
            asRecord(smile.nodes) != null ||
            Array.isArray(smile.fly_node_points))
        );
      });
    if (!looksLikeFly) continue;

    const ts = safeNumber(candidate.ts) ?? safeNumber(root.ts);
    if (ts == null) continue;

    const normalizedSmiles: SviFlySmile[] = smiles
      .map((rawSmile) => normalizeSviFlySmile(rawSmile))
      .filter((smile): smile is SviFlySmile => smile != null);

    return {
      type: "svi_fly_patch",
      ts,
      ccy:
        (typeof candidate.ccy === "string" ? candidate.ccy : undefined) ??
        (typeof root.ccy === "string" ? root.ccy : undefined),
      partial: candidate.partial === true,
      smiles: normalizedSmiles,
    };
  }

  return null;
}

function compareSmilesByExpiry(left: SviSmile, right: SviSmile) {
  const leftExpiry = safeNumber(left.expiry) ?? Number.POSITIVE_INFINITY;
  const rightExpiry = safeNumber(right.expiry) ?? Number.POSITIVE_INFINITY;
  if (leftExpiry !== rightExpiry) return leftExpiry - rightExpiry;
  return (left.label ?? "").localeCompare(right.label ?? "");
}

function sortSmilesByExpiry(smiles: SviSmile[]) {
  return [...smiles].sort(compareSmilesByExpiry);
}

function normalizeSnapshotOrder(snapshot: SviSurfaceSnapshot) {
  return {
    ...snapshot,
    surface_grid: snapshot.surface_grid
      ? {
          ...snapshot.surface_grid,
          rows: [...(snapshot.surface_grid.rows ?? [])].sort((left, right) => {
            const leftExpiry = safeNumber(left.expiry) ?? Number.POSITIVE_INFINITY;
            const rightExpiry = safeNumber(right.expiry) ?? Number.POSITIVE_INFINITY;
            return leftExpiry - rightExpiry;
          }),
        }
      : snapshot.surface_grid,
    smiles: sortSmilesByExpiry(snapshot.smiles ?? []),
  };
}

function buildExpiryKeyCandidates(expiry: number) {
  const candidates = new Set<string>([String(expiry)]);
  const normalized = safeNumber(expiry);
  if (normalized == null) {
    return [...candidates];
  }

  if (Math.abs(normalized) < 1e11) {
    candidates.add(String(Math.round(normalized * 1000)));
  } else {
    candidates.add(String(Math.round(normalized / 1000)));
  }

  return [...candidates];
}

function applyAtmUpdate(current: QuotesByExpiry, message: AtmMessage) {
  const expiryCandidates = buildExpiryKeyCandidates(message.expiry);
  const existingKey = expiryCandidates.find((candidate) => current[candidate] != null);
  const expiryKey = existingKey ?? String(message.expiry);
  const existing = current[expiryKey];
  const eventTs =
    safeNumber(message.ts) ??
    safeNumber(message.received_ms) ??
    Date.now();
  if (existing && eventTs < (existing.ts ?? Number.NEGATIVE_INFINITY)) {
    return current;
  }

  const nextState = {
    ts: Math.max(existing?.ts ?? Number.NEGATIVE_INFINITY, eventTs),
    atm:
      safeNumber(message.atm) ??
      safeNumber(message.underlying_price) ??
      existing?.atm ??
      null,
    atmVersion: existing?.atmVersion ?? null,
    sourcePrice: safeNumber(message.source_price) ?? existing?.sourcePrice ?? null,
    priceSource:
      (typeof message.price_source === "string" ? message.price_source : undefined) ??
      existing?.priceSource,
    interpolated:
      typeof message.interpolated === "boolean" ? message.interpolated : existing?.interpolated,
    sourceExchange:
      (typeof message.source_exchange === "string" ? message.source_exchange : undefined) ??
      existing?.sourceExchange,
    sourceInstrument:
      (typeof message.source_instrument === "string" ? message.source_instrument : undefined) ??
      existing?.sourceInstrument,
    lastTradePrice: existing?.lastTradePrice ?? null,
    label:
      (typeof message.label === "string" ? message.label : undefined) ??
      existing?.label,
    pointsByStrike: existing?.pointsByStrike ?? {},
  };

  if (
    existing &&
    existing.ts === nextState.ts &&
    existing.atm === nextState.atm &&
    existing.sourcePrice === nextState.sourcePrice &&
    existing.priceSource === nextState.priceSource &&
    existing.interpolated === nextState.interpolated &&
    existing.sourceExchange === nextState.sourceExchange &&
    existing.sourceInstrument === nextState.sourceInstrument &&
    existing.label === nextState.label
  ) {
    return current;
  }

  return {
    ...current,
    [expiryKey]: nextState,
  };
}

function removeQuoteStateForSmile(current: QuotesByExpiry, message: SmileLevelsRemoveMessage) {
  const keys = new Set(buildExpiryKeyCandidates(message.expiry));
  const targetLabel = typeof message.label === "string" ? message.label.trim().toUpperCase() : "";
  let changed = false;

  const next: QuotesByExpiry = {};
  for (const [expiryKey, quoteState] of Object.entries(current)) {
    const quoteLabel = typeof quoteState.label === "string" ? quoteState.label.trim().toUpperCase() : "";
    const removeByLabel = targetLabel !== "" && quoteLabel === targetLabel;
    if (keys.has(expiryKey) || removeByLabel) {
      changed = true;
      continue;
    }
    next[expiryKey] = quoteState;
  }

  return changed ? next : current;
}

function createPlaceholderSmile(addMessage: SmileLevelsAddMessage): SviSmile {
  return {
    expiry: addMessage.expiry,
    label: addMessage.label ?? String(addMessage.expiry),
    var: [],
    vol: [],
  };
}

function mergeSurfaceGrid(
  previousGrid: SviSurfaceSnapshot["surface_grid"] | undefined,
  nextGridPatch: SviSurfacePatch["surface_grid"] | undefined
): SviSurfaceSnapshot["surface_grid"] | undefined {
  if (!nextGridPatch) {
    return previousGrid;
  }

  if (!previousGrid) {
    return {
      ...nextGridPatch,
      x_values: [...(nextGridPatch.x_values ?? [])],
      rows: [...(nextGridPatch.rows ?? [])].sort((left, right) => left.expiry - right.expiry),
    };
  }

  const rowsByExpiry = new Map<number, typeof previousGrid.rows[number]>();
  for (const row of previousGrid.rows ?? []) {
    const expiry = safeNumber(row.expiry);
    if (expiry == null) continue;
    rowsByExpiry.set(expiry, row);
  }

  for (const row of nextGridPatch.rows ?? []) {
    const expiry = safeNumber(row.expiry);
    if (expiry == null) continue;
    const previousRow = rowsByExpiry.get(expiry);
    rowsByExpiry.set(expiry, {
      ...(previousRow ?? { expiry }),
      ...row,
      expiry,
      var: Array.isArray(row.var) ? row.var : previousRow?.var ?? [],
      vol: Array.isArray(row.vol) ? row.vol : previousRow?.vol ?? [],
      g_test: Array.isArray(row.g_test) ? row.g_test : previousRow?.g_test ?? [],
      g_test_unit:
        typeof row.g_test_unit === "string"
          ? row.g_test_unit
          : previousRow?.g_test_unit,
    });
  }

  return {
    ...previousGrid,
    ...nextGridPatch,
    x_kind: nextGridPatch.x_kind ?? previousGrid.x_kind,
    x_values: Array.isArray(nextGridPatch.x_values) ? nextGridPatch.x_values : previousGrid.x_values,
    rows: [...rowsByExpiry.values()].sort((left, right) => left.expiry - right.expiry),
  };
}

function mergeSurfaceSmile(
  previousSmile: SviSmile | undefined,
  nextSmilePatch: SviSurfacePatchSmile
): SviSmile {
  const fallbackLabel = previousSmile?.label ?? String(nextSmilePatch.expiry);
  return {
    ...(previousSmile ?? {
      expiry: nextSmilePatch.expiry,
      label: fallbackLabel,
      var: [],
      vol: [],
    }),
    ...nextSmilePatch,
    expiry: nextSmilePatch.expiry,
    label: nextSmilePatch.label ?? fallbackLabel,
    x_axis: nextSmilePatch.x_axis ?? previousSmile?.x_axis,
    x_values: nextSmilePatch.x_values ?? previousSmile?.x_values,
    var: Array.isArray(nextSmilePatch.var) ? nextSmilePatch.var : previousSmile?.var ?? [],
    vol: Array.isArray(nextSmilePatch.vol) ? nextSmilePatch.vol : previousSmile?.vol ?? [],
    g_test: Array.isArray(nextSmilePatch.g_test) ? nextSmilePatch.g_test : previousSmile?.g_test ?? [],
    g_test_unit:
      typeof nextSmilePatch.g_test_unit === "string"
        ? nextSmilePatch.g_test_unit
        : previousSmile?.g_test_unit,
  };
}

function applySurfacePatchToSnapshot(
  current: SviSurfaceSnapshot | null,
  message: SviSurfacePatch
): SviSurfaceSnapshot {
  const incomingTs = safeNumber(message.ts);
  const baseTs = current?.ts ?? incomingTs ?? Date.now();
  const baseCcy =
    (typeof message.ccy === "string" && message.ccy) ||
    current?.ccy ||
    "—";
  const base: SviSurfaceSnapshot =
    current ??
    ({
      type: "svi_surface_snapshot",
      ts: baseTs,
      ccy: baseCcy,
      smiles: [],
    } as SviSurfaceSnapshot);

  const byExpiry = new Map<number, SviSmile>();
  for (const smile of base.smiles ?? []) {
    byExpiry.set(smile.expiry, smile);
  }

  for (const smilePatch of message.smiles ?? []) {
    const expiry = safeNumber(smilePatch.expiry);
    if (expiry == null) continue;
    const normalizedPatch: SviSurfacePatchSmile = {
      ...smilePatch,
      expiry,
    };
    const previousSmile = byExpiry.get(expiry);
    byExpiry.set(expiry, mergeSurfaceSmile(previousSmile, normalizedPatch));
  }

  const nextSnapshot = normalizeSnapshotOrder({
    ...base,
    ts: incomingTs != null ? Math.max(base.ts ?? Number.NEGATIVE_INFINITY, incomingTs) : base.ts,
    ccy: (typeof message.ccy === "string" && message.ccy) ? message.ccy : base.ccy,
    surface_grid: mergeSurfaceGrid(base.surface_grid, message.surface_grid),
    x_axis: message.x_axis ?? base.x_axis,
    smiles: [...byExpiry.values()],
  });

  return nextSnapshot;
}

function applySmileLevelsAddToSnapshot(
  current: SviSurfaceSnapshot | null,
  message: SmileLevelsAddMessage
): SviSurfaceSnapshot {
  const base =
    current ??
    ({
      type: "svi_surface_snapshot",
      ts: message.ts,
      ccy: message.ccy,
      smiles: [],
    } as SviSurfaceSnapshot);

  const baseSmiles = base.smiles ?? [];
  const existingIdx = baseSmiles.findIndex((smile) => smile.expiry === message.expiry);
  const nextSmiles =
    existingIdx >= 0
      ? baseSmiles.map((smile, idx) => {
          if (idx !== existingIdx) return smile;
          if (!message.label || message.label === smile.label) return smile;
          return {
            ...smile,
            label: message.label,
          };
        })
      : [...baseSmiles, createPlaceholderSmile(message)];

  return normalizeSnapshotOrder({
    ...base,
    ts: Math.max(base.ts ?? Number.NEGATIVE_INFINITY, message.ts),
    ccy: message.ccy || base.ccy,
    smiles: nextSmiles,
  });
}

function applySmileLevelsRemoveToSnapshot(
  current: SviSurfaceSnapshot | null,
  message: SmileLevelsRemoveMessage
) {
  if (!current) return current;

  const targetLabel = typeof message.label === "string" ? message.label.trim().toUpperCase() : "";
  const currentSmiles = current.smiles ?? [];
  const filtered = currentSmiles.filter((smile) => {
    if (smile.expiry === message.expiry) return false;
    if (!targetLabel) return true;
    return (smile.label ?? "").trim().toUpperCase() !== targetLabel;
  });
  if (filtered.length === currentSmiles.length) {
    return current;
  }

  return normalizeSnapshotOrder({
    ...current,
    ts: Math.max(current.ts ?? Number.NEGATIVE_INFINITY, message.ts),
    smiles: filtered,
  });
}

function removeRiskStateForSmile(current: RiskReversalByExpiry, message: SmileLevelsRemoveMessage) {
  const keys = new Set(buildExpiryKeyCandidates(message.expiry));
  const targetLabel = typeof message.label === "string" ? message.label.trim().toUpperCase() : "";
  let changed = false;

  const next: RiskReversalByExpiry = {};
  for (const [expiryKey, riskState] of Object.entries(current)) {
    const riskLabel = typeof riskState.label === "string" ? riskState.label.trim().toUpperCase() : "";
    const removeByLabel = targetLabel !== "" && riskLabel === targetLabel;
    if (keys.has(expiryKey) || removeByLabel) {
      changed = true;
      continue;
    }
    next[expiryKey] = riskState;
  }

  return changed ? next : current;
}

function removeFlyStateForSmile(current: FlyByExpiry, message: SmileLevelsRemoveMessage) {
  const keys = new Set(buildExpiryKeyCandidates(message.expiry));
  const targetLabel = typeof message.label === "string" ? message.label.trim().toUpperCase() : "";
  let changed = false;

  const next: FlyByExpiry = {};
  for (const [expiryKey, flyState] of Object.entries(current)) {
    const flyLabel = typeof flyState.label === "string" ? flyState.label.trim().toUpperCase() : "";
    const removeByLabel = targetLabel !== "" && flyLabel === targetLabel;
    if (keys.has(expiryKey) || removeByLabel) {
      changed = true;
      continue;
    }
    next[expiryKey] = flyState;
  }

  return changed ? next : current;
}

function applyRiskReversalUpdate(
  current: RiskReversalByExpiry,
  message: RiskReversalUpdateMessage,
  fallbackTs: number
) {
  const normalized = normalizeRiskReversalUpdateMessage(message);
  if (!normalized) return current;

  const expiryKey = String(normalized.expiry);
  const existing = current[expiryKey];
  const ts = normalized.ts ?? fallbackTs;
  const nextTs = Math.max(existing?.ts ?? Number.NEGATIVE_INFINITY, ts);

  if (existing && ts < existing.ts) {
    return current;
  }

  return {
    ...current,
    [expiryKey]: {
      ts: nextTs,
      expiry: normalized.expiry,
      label: normalized.label ?? existing?.label,
      days: normalized.days ?? existing?.days,
      risk_reversal_nodes: {
        ...(existing?.risk_reversal_nodes ?? {}),
        ...normalized.risk_reversal_nodes,
      },
      risk_reversals: {
        ...(existing?.risk_reversals ?? {}),
        ...(normalized.risk_reversals ?? {}),
      },
    },
  };
}

function applySnapshotRiskReversals(
  current: RiskReversalByExpiry,
  snapshot: SviSurfaceSnapshot
) {
  let next = current;

  const liveKeys = new Set<string>();
  for (const smile of snapshot.smiles ?? []) {
    const smileRecord = asRecord(smile);
    const normalizedNodes = {
      ...normalizeRiskNodeMap(smile.risk_reversal_nodes),
      ...normalizeRiskNodeMap(smileRecord?.nodes),
      ...normalizeRiskNodeArray(smileRecord?.risk_reversal_node_points),
    };
    if (Object.keys(normalizedNodes).length === 0) continue;

    const expiryKey = String(smile.expiry);
    liveKeys.add(expiryKey);
    const existing = next[expiryKey];
    next = {
      ...next,
      [expiryKey]: {
        ts: Math.max(existing?.ts ?? Number.NEGATIVE_INFINITY, snapshot.ts ?? 0),
        expiry: smile.expiry,
        label: smile.label ?? existing?.label,
        days: smile.days ?? existing?.days,
        risk_reversal_nodes: {
          ...(existing?.risk_reversal_nodes ?? {}),
          ...normalizedNodes,
        },
        risk_reversals: {
          ...(existing?.risk_reversals ?? {}),
          ...(smile.risk_reversals ?? {}),
        },
      },
    };
  }

  if (liveKeys.size === 0) return next;

  let pruned = false;
  const filtered: RiskReversalByExpiry = {};
  for (const [key, riskState] of Object.entries(next)) {
    if (liveKeys.has(key)) {
      filtered[key] = riskState;
      continue;
    }
    pruned = true;
  }
  return pruned ? filtered : next;
}

function applySviFlyPatch(current: FlyByExpiry, message: SviFlyPatchMessage, fallbackTs: number) {
  const normalized = normalizeSviFlyPatchMessage(message);
  if (!normalized) return current;

  const base = normalized.partial ? current : {};
  let changed = !normalized.partial;

  const next: FlyByExpiry = { ...base };
  const effectiveTs = normalized.ts ?? fallbackTs;

  for (const smile of normalized.smiles ?? []) {
    const expiryKey = String(smile.expiry);
    const existing = next[expiryKey];
    if (existing && effectiveTs < existing.ts) {
      continue;
    }

    const nextTs = Math.max(existing?.ts ?? Number.NEGATIVE_INFINITY, effectiveTs);
    const nextFlies = normalized.partial
      ? {
          ...(existing?.flies ?? {}),
          ...(smile.flies ?? {}),
        }
      : {
          ...(smile.flies ?? {}),
        };
    const nextNodes = normalized.partial
      ? {
          ...(existing?.nodes ?? {}),
          ...(smile.nodes ?? {}),
        }
      : {
          ...(smile.nodes ?? {}),
        };

    const previous = existing;
    const nextState = {
      ts: nextTs,
      expiry: smile.expiry,
      label: smile.label ?? existing?.label,
      days: smile.days ?? existing?.days,
      atm: smile.atm ?? existing?.atm ?? null,
      atmVersion: smile.atm_version ?? existing?.atmVersion ?? null,
      flies: Object.keys(nextFlies).length > 0 ? nextFlies : undefined,
      nodes: Object.keys(nextNodes).length > 0 ? nextNodes : undefined,
    };
    next[expiryKey] = nextState;

    if (
      !previous ||
      previous.ts !== nextState.ts ||
      previous.label !== nextState.label ||
      previous.days !== nextState.days ||
      previous.atm !== nextState.atm ||
      previous.atmVersion !== nextState.atmVersion ||
      previous.flies !== nextState.flies ||
      previous.nodes !== nextState.nodes
    ) {
      changed = true;
    }
  }

  return changed ? next : current;
}

function normalizeTenorKey(tenor: string | undefined, targetExpiry: number | null | undefined) {
  const normalizedTenor = typeof tenor === "string" ? tenor.trim().toUpperCase() : "";
  if (normalizedTenor) return normalizedTenor;
  if (targetExpiry != null && Number.isFinite(targetExpiry)) return `EXPIRY_${Math.round(targetExpiry)}`;
  return "";
}

function normalizeNumericMap(rawMap: unknown) {
  const mapRecord = asRecord(rawMap);
  if (!mapRecord) return {} as Record<string, number | null | undefined>;

  const next: Record<string, number | null | undefined> = {};
  for (const [key, value] of Object.entries(mapRecord)) {
    const trimmed = key.trim();
    if (!trimmed) continue;
    next[trimmed] = safeNumber(value);
  }
  return next;
}

function normalizeTenorRow(
  rawRow: SviTenorRow | Record<string, unknown>,
  fallbackTs: number
): TenorState | null {
  const row = asRecord(rawRow);
  if (!row) return null;

  const tenor =
    (typeof row.tenor === "string" && row.tenor.trim()) ||
    undefined;
  const tenorDays = safeNumber(row.tenor_days);
  const targetExpiry = safeNumber(row.target_expiry);
  const key = normalizeTenorKey(tenor, targetExpiry);
  if (!key) return null;

  return {
    ts: fallbackTs,
    tenor: tenor ?? key,
    tenorDays: tenorDays ?? undefined,
    targetExpiry: targetExpiry ?? null,
    days: safeNumber(row.days) ?? undefined,
    forward: safeNumber(row.forward),
    vols: normalizeNumericMap(row.vols),
    rrFly: normalizeNumericMap(row.rr_fly),
    nodes: normalizeRiskNodeMap(row.nodes),
    isExtrapolated: typeof row.is_extrapolated === "boolean" ? row.is_extrapolated : undefined,
  };
}

function mergeTenorRow(previous: TenorState | undefined, incoming: TenorState): TenorState {
  const nextVols = {
    ...(previous?.vols ?? {}),
    ...(incoming.vols ?? {}),
  };
  const nextRrFly = {
    ...(previous?.rrFly ?? {}),
    ...(incoming.rrFly ?? {}),
  };
  const nextNodes = {
    ...(previous?.nodes ?? {}),
  };
  for (const [key, node] of Object.entries(incoming.nodes ?? {})) {
    nextNodes[key] = {
      ...(previous?.nodes?.[key] ?? {}),
      ...node,
      label: node.label ?? previous?.nodes?.[key]?.label ?? key,
    };
  }

  return {
    ts: Math.max(previous?.ts ?? Number.NEGATIVE_INFINITY, incoming.ts),
    tenor: incoming.tenor || previous?.tenor || "",
    tenorDays: incoming.tenorDays ?? previous?.tenorDays,
    targetExpiry: incoming.targetExpiry ?? previous?.targetExpiry ?? null,
    days: incoming.days ?? previous?.days,
    forward: incoming.forward ?? previous?.forward ?? null,
    vols: Object.keys(nextVols).length > 0 ? nextVols : undefined,
    rrFly: Object.keys(nextRrFly).length > 0 ? nextRrFly : undefined,
    nodes: Object.keys(nextNodes).length > 0 ? nextNodes : undefined,
    isExtrapolated: incoming.isExtrapolated ?? previous?.isExtrapolated,
  };
}

function maxTenorTs(current: TenorByKey) {
  let maxTs = Number.NEGATIVE_INFINITY;
  for (const row of Object.values(current)) {
    const ts = safeNumber(row.ts);
    if (ts != null && ts > maxTs) {
      maxTs = ts;
    }
  }
  return maxTs;
}

function applyTenorSnapshot(_current: TenorByKey, message: SviTenorSnapshotMessage): TenorByKey {
  const fallbackTs = safeNumber(message.ts) ?? Date.now();
  const currentMaxTs = maxTenorTs(_current);
  if (currentMaxTs > Number.NEGATIVE_INFINITY && fallbackTs < currentMaxTs) {
    return _current;
  }
  const next: TenorByKey = {};

  for (const rawRow of message.rows ?? []) {
    const normalized = normalizeTenorRow(rawRow, fallbackTs);
    if (!normalized) continue;
    const key = normalizeTenorKey(normalized.tenor, normalized.targetExpiry);
    if (!key) continue;
    next[key] = mergeTenorRow(undefined, normalized);
  }

  return next;
}

function applyTenorPatch(current: TenorByKey, message: SviTenorPatchMessage): TenorByKey {
  const fallbackTs = safeNumber(message.ts) ?? Date.now();
  let changed = false;
  const next: TenorByKey = { ...current };

  for (const rawRow of message.rows ?? []) {
    const normalized = normalizeTenorRow(rawRow, fallbackTs);
    if (!normalized) continue;
    const key = normalizeTenorKey(normalized.tenor, normalized.targetExpiry);
    if (!key) continue;
    const previous = next[key];
    if (previous && normalized.ts < previous.ts) continue;
    const merged = mergeTenorRow(previous, normalized);
    next[key] = merged;
    if (previous !== merged) changed = true;
  }

  return changed ? next : current;
}

function pruneFlyStateBySnapshot(current: FlyByExpiry, snapshot: SviSurfaceSnapshot | null) {
  if (!snapshot) return current;

  const activeExpiries = new Set<string>();
  for (const smile of snapshot.smiles ?? []) {
    for (const key of buildExpiryKeyCandidates(smile.expiry)) {
      activeExpiries.add(key);
    }
  }
  let changed = false;
  const next: FlyByExpiry = {};
  for (const [expiryKey, flyState] of Object.entries(current)) {
    const numericExpiryKey = safeNumber(expiryKey);
    const flyExpiryCandidates = numericExpiryKey == null ? [expiryKey] : buildExpiryKeyCandidates(numericExpiryKey);
    const isActive = flyExpiryCandidates.some((key) => activeExpiries.has(key));
    if (!isActive) {
      changed = true;
      continue;
    }
    next[expiryKey] = flyState;
  }

  return changed ? next : current;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function hasFitLikeShape(record: Record<string, unknown>) {
  const fit = asRecord(record.fit);
  const live = asRecord(record.live);
  const directCurrentFit = asRecord(record.current_fit);
  const directLastFit = asRecord(record.last_fit);

  const hasFitShape =
    fit != null &&
    (asRecord(fit.current_fit) != null ||
      asRecord(fit.last_fit) != null ||
      "last_fit_error" in fit ||
      "last_fit_elapsed_seconds" in fit);

  const hasLiveShape =
    live != null &&
    ("current_error" in live || "error_per_point" in live || "total_points" in live);

  const hasDirectFitShape =
    directCurrentFit != null ||
    directLastFit != null ||
    "last_fit_error" in record ||
    "last_fit_elapsed_seconds" in record ||
    "live_error" in record;

  return hasFitShape || hasLiveShape || hasDirectFitShape;
}

function resolveFitEnvelope(message: IncomingMessage): Record<string, unknown> | null {
  const root = asRecord(message);
  if (!root) return null;

  const envelopeCandidates = [
    root,
    asRecord(root.payload),
    asRecord(root.data),
    asRecord(root.message),
  ].filter((candidate): candidate is Record<string, unknown> => candidate != null);
  const candidates: Record<string, unknown>[] = [];
  for (const candidate of envelopeCandidates) {
    candidates.push(candidate);
    const fitStatus = asRecord(candidate.fit_status);
    if (fitStatus) candidates.push(fitStatus);
  }

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
  const [riskReversalByExpiry, setRiskReversalByExpiry] = useState<RiskReversalByExpiry>({});
  const [flyByExpiry, setFlyByExpiry] = useState<FlyByExpiry>({});
  const [tenorByKey, setTenorByKey] = useState<TenorByKey>({});
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
  const debugEnabledRef = useRef(false);
  const receivedMessagesRef = useRef(0);
  const invalidMessagesRef = useRef(0);
  const droppedMessagesRef = useRef(0);
  const maxPendingMessagesRef = useRef(0);
  const flushCountRef = useRef(0);
  const lastFlushDurationMsRef = useRef(0);
  const latestSnapshotRef = useRef<SviSurfaceSnapshot | null>(null);
  const latestQuotesRef = useRef<QuotesByExpiry>({});
  const latestRiskReversalRef = useRef<RiskReversalByExpiry>({});
  const latestFlyRef = useRef<FlyByExpiry>({});
  const latestTenorRef = useRef<TenorByKey>({});
  const flushPendingMessagesRef = useRef<() => void>(() => {});
  const connectRef = useRef<() => void>(() => {});

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

    if (pendingMessagesRef.current.length === 0) {
      return;
    }

    const startedAt = performance.now();
    const messages = pendingMessagesRef.current.splice(0, MAX_MESSAGES_PER_FLUSH);

    if (messages.length === 0) return;

    let latestCurrentFitError: number | undefined;
    let latestLastFitError: number | undefined;
    let latestElapsedSeconds: number | undefined;
    let latestStatus: string | null = null;
    let latestSmileStatusText: string | null = null;
    const orderedSmileOperations: Array<
      | { kind: "atm_update"; message: AtmMessage }
      | { kind: "surface_snapshot"; message: SviSurfaceSnapshot }
      | { kind: "surface_patch"; message: SviSurfacePatch }
      | { kind: "tenor_snapshot"; message: SviTenorSnapshotMessage }
      | { kind: "tenor_patch"; message: SviTenorPatchMessage }
      | { kind: "smile_add"; message: SmileLevelsAddMessage }
      | { kind: "smile_remove"; message: SmileLevelsRemoveMessage }
      | { kind: "smile_snapshot"; message: SmileSnapshotMessage }
      | { kind: "smile_levels_snapshot"; message: SmileLevelsSnapshotMessage }
      | { kind: "smile_levels_patch"; message: SmileLevelsPatchMessage }
      | { kind: "smile_point_update"; message: SmilePointUpdateMessage }
      | { kind: "risk_reversal_update"; message: RiskReversalUpdateMessage }
      | { kind: "svi_fly_patch"; message: SviFlyPatchMessage }
    > = [];

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
      }

      if (isSurfaceSnapshot(message)) {
        orderedSmileOperations.push({
          kind: "surface_snapshot",
          message,
        });
        continue;
      }

      if (isSurfacePatch(message)) {
        orderedSmileOperations.push({
          kind: "surface_patch",
          message,
        });
        continue;
      }

      if (isAtmMessage(message)) {
        orderedSmileOperations.push({
          kind: "atm_update",
          message,
        });
        continue;
      }

      if (isSviTenorSnapshotMessage(message)) {
        orderedSmileOperations.push({
          kind: "tenor_snapshot",
          message,
        });
        continue;
      }

      if (isSviTenorPatchMessage(message)) {
        orderedSmileOperations.push({
          kind: "tenor_patch",
          message,
        });
        continue;
      }

      if (isSmileSnapshotMessage(message)) {
        orderedSmileOperations.push({
          kind: "smile_snapshot",
          message,
        });
        continue;
      }

      if (isSmileLevelsSnapshotMessage(message)) {
        orderedSmileOperations.push({
          kind: "smile_levels_snapshot",
          message,
        });
        continue;
      }

      if (isSmileLevelsPatchMessage(message)) {
        orderedSmileOperations.push({
          kind: "smile_levels_patch",
          message,
        });
        continue;
      }

      if (isSmileLevelsAddMessage(message)) {
        orderedSmileOperations.push({
          kind: "smile_add",
          message,
        });
        continue;
      }

      if (isSmileLevelsRemoveMessage(message)) {
        orderedSmileOperations.push({
          kind: "smile_remove",
          message,
        });
        continue;
      }

      let handledPatchPayload = false;
      if (isSviFlyPatchMessage(message)) {
        const normalizedFlyMessage = normalizeSviFlyPatchMessage(message);
        if (normalizedFlyMessage) {
          orderedSmileOperations.push({
            kind: "svi_fly_patch",
            message: normalizedFlyMessage,
          });
          handledPatchPayload = true;
        }
      }
      const normalizedRiskMessages = normalizeRiskReversalUpdateMessages(message);
      if (normalizedRiskMessages.length > 0) {
        for (const normalizedRiskMessage of normalizedRiskMessages) {
          orderedSmileOperations.push({
            kind: "risk_reversal_update",
            message: normalizedRiskMessage,
          });
        }
        handledPatchPayload = true;
      }
      if (handledPatchPayload) {
        continue;
      }

      if (isSmilePointUpdateMessage(message)) {
        orderedSmileOperations.push({
          kind: "smile_point_update",
          message,
        });
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

    if (orderedSmileOperations.length > 0) {
      let nextSnapshot = latestSnapshotRef.current;
      let nextQuotes = latestQuotesRef.current;
      let nextRiskReversal = latestRiskReversalRef.current;
      let nextFly = latestFlyRef.current;
      let nextTenor = latestTenorRef.current;
      let snapshotChanged = false;
      let quotesChanged = false;
      let riskReversalChanged = false;
      let flyChanged = false;
      let tenorChanged = false;

      for (const operation of orderedSmileOperations) {
        switch (operation.kind) {
          case "atm_update": {
            const updated = applyAtmUpdate(nextQuotes, operation.message);
            if (updated !== nextQuotes) {
              nextQuotes = updated;
              quotesChanged = true;
            }
            break;
          }
          case "surface_snapshot": {
            nextSnapshot = normalizeSnapshotOrder(operation.message);
            snapshotChanged = true;
            const updatedRisk = applySnapshotRiskReversals(nextRiskReversal, nextSnapshot);
            if (updatedRisk !== nextRiskReversal) {
              nextRiskReversal = updatedRisk;
              riskReversalChanged = true;
            }
            const prunedFly = pruneFlyStateBySnapshot(nextFly, nextSnapshot);
            if (prunedFly !== nextFly) {
              nextFly = prunedFly;
              flyChanged = true;
            }
            latestSmileStatusText = `Received ${nextSnapshot.smiles.length} smiles`;
            break;
          }
          case "surface_patch": {
            const updated = applySurfacePatchToSnapshot(nextSnapshot, operation.message);
            if (updated !== nextSnapshot) {
              nextSnapshot = updated;
              snapshotChanged = true;
            }
            latestSmileStatusText = `Updated ${nextSnapshot.smiles.length} smiles`;
            break;
          }
          case "tenor_snapshot": {
            const updated = applyTenorSnapshot(nextTenor, operation.message);
            if (updated !== nextTenor) {
              nextTenor = updated;
              tenorChanged = true;
            }
            latestSmileStatusText = `Updated ${Object.keys(nextTenor).length} tenors`;
            break;
          }
          case "tenor_patch": {
            const updated = applyTenorPatch(nextTenor, operation.message);
            if (updated !== nextTenor) {
              nextTenor = updated;
              tenorChanged = true;
            }
            latestSmileStatusText = `Updated ${Object.keys(nextTenor).length} tenors`;
            break;
          }
          case "smile_add": {
            const updated = applySmileLevelsAddToSnapshot(nextSnapshot, operation.message);
            if (updated !== nextSnapshot) {
              nextSnapshot = updated;
              snapshotChanged = true;
            }
            latestSmileStatusText = `Tracking ${nextSnapshot.smiles.length} smiles`;
            break;
          }
          case "smile_remove": {
            const updatedSnapshot = applySmileLevelsRemoveToSnapshot(nextSnapshot, operation.message);
            if (updatedSnapshot !== nextSnapshot) {
              nextSnapshot = updatedSnapshot;
              snapshotChanged = true;
            }

            const updatedQuotes = removeQuoteStateForSmile(nextQuotes, operation.message);
            if (updatedQuotes !== nextQuotes) {
              nextQuotes = updatedQuotes;
              quotesChanged = true;
            }
            const updatedRisk = removeRiskStateForSmile(nextRiskReversal, operation.message);
            if (updatedRisk !== nextRiskReversal) {
              nextRiskReversal = updatedRisk;
              riskReversalChanged = true;
            }
            const updatedFly = removeFlyStateForSmile(nextFly, operation.message);
            if (updatedFly !== nextFly) {
              nextFly = updatedFly;
              flyChanged = true;
            }

            latestSmileStatusText = `Tracking ${nextSnapshot?.smiles?.length ?? 0} smiles`;
            break;
          }
          case "smile_levels_snapshot":
          case "smile_levels_patch": {
            nextQuotes = applySmileLevelsSnapshot(nextQuotes, operation.message);
            quotesChanged = true;
            break;
          }
          case "smile_snapshot": {
            nextQuotes = applySmileSnapshot(nextQuotes, operation.message);
            quotesChanged = true;
            break;
          }
          case "smile_point_update": {
            nextQuotes = applySmilePointUpdate(nextQuotes, operation.message);
            quotesChanged = true;
            break;
          }
          case "risk_reversal_update": {
            const updated = applyRiskReversalUpdate(nextRiskReversal, operation.message, Date.now());
            if (updated !== nextRiskReversal) {
              nextRiskReversal = updated;
              riskReversalChanged = true;
            }
            break;
          }
          case "svi_fly_patch": {
            const updated = applySviFlyPatch(nextFly, operation.message, Date.now());
            if (updated !== nextFly) {
              nextFly = updated;
              flyChanged = true;
            }
            break;
          }
        }
      }

      if (nextSnapshot) {
        const prunedBySnapshot = pruneQuotesBySnapshot(nextQuotes, nextSnapshot);
        if (prunedBySnapshot !== nextQuotes) {
          nextQuotes = prunedBySnapshot;
          quotesChanged = true;
        }
      }

      const boundedQuotes = pruneQuotesByLimits(nextQuotes, nextSnapshot?.ts ?? null);
      if (boundedQuotes !== nextQuotes) {
        nextQuotes = boundedQuotes;
        quotesChanged = true;
      }

      const prunedFly = pruneFlyStateBySnapshot(nextFly, nextSnapshot);
      if (prunedFly !== nextFly) {
        nextFly = prunedFly;
        flyChanged = true;
      }

      if (snapshotChanged) {
        latestSnapshotRef.current = nextSnapshot;
        setSnapshot(nextSnapshot);

        setLastSnapshotUpdated((current) => {
          const nextTs = nextSnapshot?.ts ?? null;
          if (current != null && nextTs != null && nextTs < current) {
            return current;
          }
          return nextTs ?? current;
        });
      }

      if (quotesChanged) {
        latestQuotesRef.current = nextQuotes;
        setQuotesByExpiry(nextQuotes);
      }

      if (riskReversalChanged) {
        latestRiskReversalRef.current = nextRiskReversal;
        setRiskReversalByExpiry(nextRiskReversal);
      }

      if (flyChanged) {
        latestFlyRef.current = nextFly;
        setFlyByExpiry(nextFly);
      }

      if (tenorChanged) {
        latestTenorRef.current = nextTenor;
        setTenorByKey(nextTenor);
      }
    }

    if (latestSmileStatusText) {
      setStatusText(latestSmileStatusText);
    }

    lastFlushDurationMsRef.current = performance.now() - startedAt;
    flushCountRef.current += 1;

    if (pendingMessagesRef.current.length > 0 && !flushScheduledRef.current) {
      flushScheduledRef.current = true;
      requestAnimationFrame(() => flushPendingMessagesRef.current());
    }
  });

  useEffect(() => {
    flushPendingMessagesRef.current = flushPendingMessages;
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

    let ws: WebSocket;
    try {
      ws = new WebSocket(FALLBACK_WS_URL);
    } catch (error) {
      setConnected(false);

      if (!shouldReconnectRef.current || manuallyClosingRef.current) {
        setStatusText("WebSocket unavailable");
        return;
      }

      const currentAttempt = reconnectAttemptRef.current;
      const delay = getReconnectDelay(currentAttempt);
      setReconnectAttempt(currentAttempt + 1);
      setStatusText(`WebSocket unavailable - retrying in ${Math.round(delay / 1000)}s`);

      if (reconnectTimeoutRef.current === null) {
        reconnectTimeoutRef.current = window.setTimeout(() => {
          reconnectTimeoutRef.current = null;
          reconnectAttemptRef.current = currentAttempt + 1;
          connectRef.current();
        }, delay);
      }

      if (debugEnabledRef.current) {
        console.warn("[svi-debug] failed to construct websocket", {
          error,
          url: FALLBACK_WS_URL,
        });
      }
      return;
    }
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
          connectRef.current();
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
        receivedMessagesRef.current += 1;

        if (pendingMessagesRef.current.length >= MAX_PENDING_MESSAGES) {
          const kept = pendingMessagesRef.current.slice(-TARGET_PENDING_MESSAGES);
          droppedMessagesRef.current += pendingMessagesRef.current.length - kept.length;
          pendingMessagesRef.current = kept;

          if (debugEnabledRef.current) {
            console.warn("[svi-debug] pending queue trimmed", {
              droppedTotal: droppedMessagesRef.current,
              kept: pendingMessagesRef.current.length,
            });
          }
        }

        pendingMessagesRef.current.push(message);
        if (pendingMessagesRef.current.length > maxPendingMessagesRef.current) {
          maxPendingMessagesRef.current = pendingMessagesRef.current.length;
        }

        if (!flushScheduledRef.current) {
          flushScheduledRef.current = true;
          requestAnimationFrame(() => flushPendingMessagesRef.current());
        }
      } catch (error) {
        invalidMessagesRef.current += 1;
        console.error("Failed to parse websocket message", error);
        setStatusText("Received invalid message");
      }
    };
  });

  useEffect(() => {
    connectRef.current = connect;
  });

  useEffect(() => {
    latestSnapshotRef.current = snapshot;
  }, [snapshot]);

  useEffect(() => {
    latestQuotesRef.current = quotesByExpiry;
  }, [quotesByExpiry]);

  useEffect(() => {
    latestRiskReversalRef.current = riskReversalByExpiry;
  }, [riskReversalByExpiry]);

  useEffect(() => {
    latestFlyRef.current = flyByExpiry;
  }, [flyByExpiry]);

  useEffect(() => {
    latestTenorRef.current = tenorByKey;
  }, [tenorByKey]);

  useEffect(() => {
    debugEnabledRef.current = isSviDebugEnabled();
    if (!debugEnabledRef.current) return;

    const intervalId = window.setInterval(() => {
      const quoteStates = Object.values(latestQuotesRef.current);
      let strikeCount = 0;
      for (const state of quoteStates) {
        strikeCount += Object.keys(state.pointsByStrike).length;
      }

      const debugPayload = {
        connected: wsRef.current?.readyState === WebSocket.OPEN,
        pendingQueue: pendingMessagesRef.current.length,
        maxPendingQueue: maxPendingMessagesRef.current,
        droppedMessages: droppedMessagesRef.current,
        receivedMessages: receivedMessagesRef.current,
        invalidMessages: invalidMessagesRef.current,
        flushes: flushCountRef.current,
        lastFlushMs: Number(lastFlushDurationMsRef.current.toFixed(2)),
        trackedExpiries: quoteStates.length,
        trackedStrikes: strikeCount,
        snapshotSmiles: latestSnapshotRef.current?.smiles?.length ?? 0,
        trackedFlyExpiries: Object.keys(latestFlyRef.current).length,
        trackedTenors: Object.keys(latestTenorRef.current).length,
        heapUsedMb: (() => {
          const memory = (
            performance as Performance & {
              memory?: { usedJSHeapSize?: number };
            }
          ).memory;
          const usedBytes = memory?.usedJSHeapSize;
          if (!Number.isFinite(usedBytes)) return null;
          return Number(((usedBytes as number) / (1024 * 1024)).toFixed(1));
        })(),
      };

      (window as Window & { __SVI_DEBUG__?: unknown }).__SVI_DEBUG__ = debugPayload;
      console.info("[svi-debug] feed", debugPayload);
    }, DEBUG_SAMPLE_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, []);

  useEffect(() => {
    shouldReconnectRef.current = true;
    reconnectAttemptRef.current = 0;
    const resetFrameId = window.requestAnimationFrame(() => {
      setReconnectAttempt(0);
    });
    connectRef.current();

    return () => {
      window.cancelAnimationFrame(resetFrameId);
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
  }, [clearReconnectTimer]);

  return {
    connected,
    currentFitError,
    lastFitError,
    lastFitElapsedSeconds,
    lastSnapshotUpdated,
    quotesByExpiry,
    reconnectAttempt,
    riskReversalByExpiry,
    flyByExpiry,
    tenorByKey,
    snapshot,
    statusText,
  };
}
