import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
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
