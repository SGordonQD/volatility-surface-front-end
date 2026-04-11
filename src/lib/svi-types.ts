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
  iv: number;
  size: number | null;
};

export type SmilePoint = {
  strike: number;
  log_moneyness: number;
  best_bid_iv?: number | null;
  best_ask_iv?: number | null;
  bid_levels?: BookLevel[];
  ask_levels?: BookLevel[];
};

export type SmileSnapshotMessage = {
  type: "smile_snapshot";
  ts: number;
  ccy: string;
  expiry: number;
  label?: string;
  points: SmilePoint[];
};

export type SmilePointUpdateMessage = {
  type: "smile_point_update";
  ts: number;
  ccy: string;
  expiry: number;
  label?: string;
  points: SmilePoint[];
};

export type IncomingMessage =
  | SviSurfaceSnapshot
  | SmileSnapshotMessage
  | SmilePointUpdateMessage
  | SurfaceFitStatusMessage
  | StatusMessage
  | Record<string, unknown>;

export type QuotesByExpiry = Record<
  string,
  {
    ts: number;
    label?: string;
    pointsByStrike: Record<string, SmilePoint>;
  }
>;

export type ScatterRow = {
  x: number;
  y: number;
  strike: number;
  level: number;
  side: "bid" | "ask";
  size: number | null;
};

export type CurveRow = {
  x: number;
  y: number | null;
};

export type SmileChartRow = {
  expiry: number;
  label: string;
  readableExpiry: string;
  curveData: CurveRow[];
  bidScatter: ScatterRow[];
  askScatter: ScatterRow[];
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
