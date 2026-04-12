export type SmileXAxis = {
  kind?: string;
  values: number[];
};

export type SviSmile = {
  expiry: number;
  label: string;
  days?: number;
  params?: {
    a: number;
    b: number;
    rho: number;
    m: number;
    sigma: number;
  };
  var: number[];
  vol?: Array<number | null>;
  x_axis?: SmileXAxis;
  x_values?: number[];
};

export type SviSurfaceSnapshot = {
  type: "svi_surface_snapshot";
  ts: number;
  ccy: string;
  x_axis?: {
    kind: string;
    values: number[];
  };
  smiles: SviSmile[];
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
  size: number | null;
  strike?: number;
  expiry?: number;
};

export type SmilePoint = {
  strike: number;
  log_moneyness: number;
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
    lastTradePrice?: number | null;
    label?: string;
    pointsByStrike: Record<string, SmilePoint>;
  }
>;

export type ScatterRow = {
  x: number;
  y: number;
  strike: number;
  level: number;
  side: "bid" | "ask" | "trade";
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
  curveData: CurveRow[];
  bidScatter: ScatterRow[];
  askScatter: ScatterRow[];
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
