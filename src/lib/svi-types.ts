export type SmileXAxis = {
  kind?: string;
  values: number[];
};

export type SviSmile = {
  expiry: number;
  label: string;
  days?: number;
  atm?: number | null;
  atm_version?: number | null;
  risk_reversal_nodes?: Record<string, RiskReversalNode>;
  risk_reversals?: Record<string, number | null | undefined>;
  flies?: Record<string, number | null | undefined>;
  nodes?: Record<string, RiskReversalNode>;
  risk_reversal_node_points?: RiskReversalNode[];
  fly_node_points?: RiskReversalNode[];
  params?: {
    a: number;
    b: number;
    rho: number;
    m: number;
    sigma: number;
  };
  var: number[];
  vol?: Array<number | null>;
  g_test?: Array<number | null>;
  g_test_unit?: string;
  x_axis?: SmileXAxis;
  x_values?: number[];
};

export type SviSurfaceGridRow = {
  expiry: number;
  label?: string;
  days?: number | null;
  atm?: number | null;
  atm_version?: number | null;
  var: Array<number | null>;
  vol: Array<number | null>;
  g_test?: Array<number | null>;
  g_test_unit?: string;
};

export type SviSurfaceGrid = {
  x_kind: string;
  x_values: number[];
  rows: SviSurfaceGridRow[];
};

export type RiskReversalNode = {
  label: string;
  option_type?: string;
  target_delta?: number;
  delta?: number;
  delta_error?: number;
  log_moneyness?: number;
  strike?: number;
  vol?: number;
};

export type SviSurfaceSnapshot = {
  type: "svi_surface_snapshot";
  ts: number;
  ccy: string;
  surface_grid?: SviSurfaceGrid;
  x_axis?: {
    kind: string;
    values: number[];
  };
  smiles: SviSmile[];
};

export type SviSurfacePatchSmile = Partial<SviSmile> & Pick<SviSmile, "expiry">;

export type SviSurfacePatch = {
  type: "svi_surface_patch";
  schemaVersion?: number;
  ts?: number;
  ccy?: string;
  partial?: boolean;
  surface_grid?: SviSurfaceGrid;
  x_axis?: {
    kind: string;
    values: number[];
  };
  smiles?: SviSurfacePatchSmile[];
};

export type SurfaceFitStatusMessage = {
  type: "surface_fit_status";
  ts: number;
  ccy: string;
  fit: {
    last_fit_error: number;
    last_fit_success?: boolean;
    last_fit_message?: string;
    last_fit_ts?: number;
    last_fit_elapsed_seconds?: number | null;
    current_fit?: {
      success?: boolean | null;
      fun?: number | null;
      message?: string | null;
      ts?: number | null;
      elapsed_seconds?: number | null;
    };
    last_fit?: {
      success?: boolean | null;
      fun?: number | null;
      message?: string | null;
      ts?: number | null;
      elapsed_seconds?: number | null;
    };
  };
  live: {
    current_error: number;
    by_expiry?: {
      expiry: number;
      label: string;
      error: number;
    }[];
  };
};

export type StatusMessage = {
  type: "status";
  message: string;
};

export type BookLevel = {
  id?: string;
  ticker?: string;
  exchange?: string;
  option_type?: string;
  side?: string;
  price?: number | null;
  iv: number;
  size?: number | null;
  strike?: number;
  expiry?: number;
};

export type SmilePointByExchange = {
  best_bid_iv?: number | null;
  best_ask_iv?: number | null;
  bid_levels?: BookLevel[];
  ask_levels?: BookLevel[];
  last_trades?: BookLevel[];
  last_trade_levels?: BookLevel[];
  last_trade_iv?: number | null;
  last_trade_price?: number | null;
};

export type SmilePoint = {
  strike: number;
  log_moneyness: number;
  exchange?: string;
  best_bid_iv?: number | null;
  best_ask_iv?: number | null;
  last_trade_iv?: number | null;
  last_trade_price?: number | null;
  last_trade_update_ts?: number | null;
  last_trade_flash_until_ts?: number | null;
  last_trade_level?: BookLevel | null;
  last_trade_levels?: BookLevel[];
  bid_levels?: BookLevel[];
  ask_levels?: BookLevel[];
  by_exchange?: Record<string, SmilePointByExchange | undefined>;
};

export type SmileUnderlying = {
  exchange?: string;
  ticker?: string;
  bid?: number | null;
  ask?: number | null;
  filtered_mid?: number | null;
  mark_price?: number | null;
  last_trade_price?: number | null;
  source_price?: number | null;
  price_source?: string;
  interpolated?: boolean;
  smile_atm?: number | null;
};

export type SmileLevelDelete = {
  id?: string;
  strike?: number;
  side?: string;
  ticker?: string;
  expiry?: number;
  exchange?: string;
};

export type SmileSnapshotMessage = {
  type: "smile_snapshot";
  ts: number;
  ccy: string;
  expiry: number;
  label?: string;
  exchange?: string;
  atm?: number | null;
  smile_atm?: number | null;
  atm_version?: number | null;
  last_trade_price?: number | null;
  underlying?: SmileUnderlying;
  points: SmilePoint[];
};

export type SmileLevelsSnapshotMessage = {
  type: "smile_levels_snapshot";
  ts: number;
  ccy: string;
  expiry: number;
  label?: string;
  exchange?: string;
  atm?: number | null;
  smile_atm?: number | null;
  atm_version?: number | null;
  last_trade_price?: number | null;
  underlying?: SmileUnderlying;
  points: SmilePoint[];
};

export type SmileLevelsPatchMessage = {
  type: "smile_levels_patch";
  ts: number;
  ccy: string;
  expiry: number;
  label?: string;
  exchange?: string;
  atm?: number | null;
  smile_atm?: number | null;
  atm_version?: number | null;
  last_trade_price?: number | null;
  underlying?: SmileUnderlying;
  points: SmilePoint[];
  upserts?: BookLevel[];
  deletes?: SmileLevelDelete[];
};

export type SmileLevelsRemoveMessage = {
  type: "smile_levels_remove";
  ts: number;
  ccy: string;
  expiry: number;
  label?: string;
};

export type SmileLevelsAddMessage = {
  type: "smile_levels_add";
  ts: number;
  ccy: string;
  expiry: number;
  label?: string;
  source_exchange?: string;
};

export type AtmMessage = {
  type?: "atm";
  event_type?: "atm";
  ts?: number;
  received_ms?: number;
  ccy?: string;
  currency?: string;
  expiry: number;
  exchange?: string;
  label?: string;
  atm?: number | null;
  underlying_price?: number | null;
  source_price?: number | null;
  source_exchange?: string;
  source_instrument?: string;
  price_source?: string;
  interpolated?: boolean;
};

export type RiskReversalUpdateMessage = {
  type?: string;
  ts?: number;
  ccy?: string;
  expiry: number;
  label?: string;
  days?: number;
  risk_reversal_nodes: Record<string, RiskReversalNode>;
  risk_reversals?: Record<string, number | null | undefined>;
};

export type SviFlySmile = {
  expiry: number;
  label?: string;
  days?: number;
  atm?: number | null;
  atm_version?: number | null;
  flies?: Record<string, number | null | undefined>;
  nodes?: Record<string, RiskReversalNode>;
};

export type SviFlyPatchMessage = {
  type: "svi_fly_patch";
  ts: number;
  ccy?: string;
  partial?: boolean;
  smiles?: SviFlySmile[];
};

export type SviTenorRow = {
  tenor?: string;
  tenor_days?: number;
  target_expiry?: number;
  days?: number;
  forward?: number;
  vols?: Record<string, number | null | undefined>;
  rr_fly?: Record<string, number | null | undefined>;
  nodes?: Record<string, RiskReversalNode>;
  is_extrapolated?: boolean;
};

export type SviTenorSnapshotMessage = {
  type: "svi_tenor_snapshot";
  ts: number;
  ccy?: string;
  rows?: SviTenorRow[];
};

export type SviTenorPatchMessage = {
  type: "svi_tenor_patch";
  ts: number;
  ccy?: string;
  rows?: SviTenorRow[];
};

export type SmilePointUpdateMessage = {
  type: "smile_point_update";
  ts: number;
  ccy: string;
  expiry: number;
  label?: string;
  exchange?: string;
  atm?: number | null;
  smile_atm?: number | null;
  atm_version?: number | null;
  last_trade_price?: number | null;
  underlying?: SmileUnderlying;
  points: SmilePoint[];
};

export type IncomingMessage =
  | SviSurfaceSnapshot
  | SviSurfacePatch
  | AtmMessage
  | SmileLevelsAddMessage
  | SmileLevelsRemoveMessage
  | RiskReversalUpdateMessage
  | SviFlyPatchMessage
  | SviTenorSnapshotMessage
  | SviTenorPatchMessage
  | SmileLevelsSnapshotMessage
  | SmileLevelsPatchMessage
  | SmileSnapshotMessage
  | SmilePointUpdateMessage
  | SurfaceFitStatusMessage
  | StatusMessage
  | Record<string, unknown>;

export type QuotesByExpiry = Record<
  string,
  {
    ts: number;
    atm?: number | null;
    atmVersion?: number | null;
    sourcePrice?: number | null;
    priceSource?: string;
    interpolated?: boolean;
    sourceExchange?: string;
    sourceInstrument?: string;
    lastTradePrice?: number | null;
    label?: string;
    pointsByStrike: Record<string, SmilePoint>;
  }
>;

export type RiskReversalState = {
  ts: number;
  expiry: number;
  label?: string;
  days?: number;
  risk_reversal_nodes: Record<string, RiskReversalNode>;
  risk_reversals?: Record<string, number | null | undefined>;
};

export type RiskReversalByExpiry = Record<string, RiskReversalState>;

export type FlyState = {
  ts: number;
  expiry: number;
  label?: string;
  days?: number;
  atm?: number | null;
  atmVersion?: number | null;
  flies?: Record<string, number | null | undefined>;
  nodes?: Record<string, RiskReversalNode>;
};

export type FlyByExpiry = Record<string, FlyState>;

export type TenorState = {
  ts: number;
  tenor: string;
  tenorDays?: number;
  targetExpiry?: number | null;
  days?: number;
  forward?: number | null;
  vols?: Record<string, number | null | undefined>;
  rrFly?: Record<string, number | null | undefined>;
  nodes?: Record<string, RiskReversalNode>;
  isExtrapolated?: boolean;
};

export type TenorByKey = Record<string, TenorState>;

export type ScatterRow = {
  x: number;
  y: number;
  strike: number;
  level: number;
  side: "bid" | "ask" | "trade";
  exchange?: string;
  size: number | null;
  tradeUpdateTs?: number | null;
  flashUntilTs?: number | null;
};

export type CurveRow = {
  x: number;
  y: number | null;
};

export type SmileChartRow = {
  expiry: number;
  label: string;
  readableExpiry: string;
  atm?: number | null;
  lastTradePrice?: number | null;
  hasDeribit: boolean;
  hasOkx: boolean;
  curveData: CurveRow[];
  bidScatter: ScatterRow[];
  askScatter: ScatterRow[];
  okxScatter: ScatterRow[];
  bestBidScatter: ScatterRow[];
  bestAskScatter: ScatterRow[];
  lastTradeScatter: ScatterRow[];
  quotePointCount: number;
  bidLevelCount: number;
  askLevelCount: number;
  plottedBidLevelCount: number;
  plottedAskLevelCount: number;
  xDomain: [number, number];
  yDomain: [number, number];
  xTicks: number[];
  yTicks: number[];
  maxVisibleSize: number;
  atmX: number | null;
};

export type VarianceSeries = {
  key: string;
  label: string;
  color: string;
  data: CurveRow[];
};

export type Margin = {
  top: number;
  right: number;
  bottom: number;
  left: number;
};
