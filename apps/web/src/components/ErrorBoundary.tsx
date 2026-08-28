import { Component, type ErrorInfo, type ReactNode } from "react";
import { track } from "@/lib/telemetry";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

// A crashing tree can re-mount and throw again; cap the reports so a render
// loop can't flood the sink with the same failure.
const MAX_REPORTS = 3;
let reportCount = 0;

// The /api/events row stores props as JSON — keep stacks to a sane size.
const MAX_MESSAGE = 300;
const MAX_STACK = 1200;

function clip(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

/**
 * Best-effort crash report to our own telemetry sink — no third-party SDK, and
 * no second crash: every step is guarded, and `track()` itself already swallows
 * transport failures rather than retrying.
 */
function reportCrash(error: Error, info: ErrorInfo): void {
  if (reportCount >= MAX_REPORTS) return;
  reportCount += 1;
  try {
    track("client_error", {
      message: clip(String(error?.message ?? error), MAX_MESSAGE),
      stack: clip(String(error?.stack ?? ""), MAX_STACK),
      componentStack: clip(String(info?.componentStack ?? ""), MAX_STACK),
      path: typeof location !== "undefined" ? location.pathname : "",
    });
  } catch {
    /* reporting the crash must never become the crash */
  }
}

/**
 * Top-level error boundary. Without it, any uncaught render error anywhere in
 * the tree unmounts the whole app to a blank white screen with no way back —
 * especially bad for an installed PWA. Catches the error and offers a reload.
 *
 * Messaging is intentionally i18n-free (the i18n layer itself may be what
 * failed); it reads the document language to stay bilingual.
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("[error-boundary]", error, info.componentStack);
    reportCrash(error, info);
  }

  override render(): ReactNode {
    if (!this.state.hasError) return this.props.children;

    const isEn =
      typeof document !== "undefined" &&
      document.documentElement.lang.toLowerCase().startsWith("en");
    const title = isEn ? "Something went wrong" : "Bir şeyler ters gitti";
    const action = isEn ? "Reload" : "Yeniden yükle";

    return (
      <div
        role="alert"
        className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center"
      >
        <p className="text-base font-medium text-text dark:text-text-dark">{title}</p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="rounded-xl border border-border px-4 py-2 text-sm font-medium dark:border-border-dark"
        >
          {action}
        </button>
      </div>
    );
  }
}
