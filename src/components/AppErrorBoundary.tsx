import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = {
  children: ReactNode;
};

type State = {
  hasError: boolean;
  message: string;
};

function recordAppCrash(error: unknown, componentStack?: string | null) {
  if (typeof window === "undefined") return;

  const payload = {
    ts: Date.now(),
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack ?? null : null,
    componentStack: componentStack ?? null,
  };

  try {
    const existingRaw = window.localStorage.getItem("SVI_CRASH_LOG");
    const existing = existingRaw ? (JSON.parse(existingRaw) as unknown[]) : [];
    const next = [...existing, payload].slice(-20);
    window.localStorage.setItem("SVI_CRASH_LOG", JSON.stringify(next));
  } catch {
    // swallow
  }

  console.error("[svi-crash]", payload);
}

export class AppErrorBoundary extends Component<Props, State> {
  state: State = {
    hasError: false,
    message: "",
  };

  static getDerivedStateFromError(error: unknown): State {
    const message = error instanceof Error ? error.message : "Unknown application error";
    return {
      hasError: true,
      message,
    };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    recordAppCrash(error, info.componentStack);
  }

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <div
        style={{
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          background: "#0b1220",
          color: "#dce7f8",
          fontFamily: '"IBM Plex Sans", system-ui, sans-serif',
          padding: "24px",
        }}
      >
        <div
          style={{
            border: "1px solid rgba(123, 153, 191, 0.34)",
            borderRadius: "12px",
            padding: "18px 20px",
            maxWidth: "720px",
            width: "100%",
            background: "rgba(13, 21, 36, 0.95)",
          }}
        >
          <h2 style={{ margin: "0 0 8px", fontSize: "18px", fontWeight: 600 }}>UI error captured</h2>
          <p style={{ margin: "0 0 14px", color: "#a9bcd7", lineHeight: 1.5 }}>
            The app hit a runtime exception. The error was saved to <code>localStorage.SVI_CRASH_LOG</code>.
          </p>
          <pre
            style={{
              margin: 0,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              color: "#ffb4a6",
              fontSize: "13px",
            }}
          >
            {this.state.message}
          </pre>
        </div>
      </div>
    );
  }
}
