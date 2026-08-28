import { ChevronDown, ChevronUp } from "lucide-react";
import { useTranslation } from "react-i18next";

/**
 * The bottom sheet that carries every non-map control.
 *
 * Two states only — a one-line summary bar and an expanded panel — because a
 * rider needs to know without thinking which of them they are looking at. The
 * whole collapsed bar is the toggle (a ~64px target the width of the screen),
 * not a small chevron, so opening and closing it never needs precision.
 *
 * It sits clear of the tab bar rather than under it: the tab bar is how you
 * leave this screen, and covering it would trap a rider on the map.
 */
export function RideSheet({
  open,
  onToggle,
  summary,
  children,
  bottomOffset,
}: {
  open: boolean;
  onToggle: () => void;
  summary: React.ReactNode;
  children: React.ReactNode;
  /** CSS length that clears the tab bar and the home indicator. */
  bottomOffset: string;
}) {
  const { t } = useTranslation();
  return (
    <div
      className="pointer-events-none absolute inset-x-0 z-10 flex flex-col justify-end px-2"
      style={{ bottom: bottomOffset }}
    >
      <div className="pointer-events-auto mx-auto w-full max-w-2xl overflow-hidden rounded-2xl bg-surface/97 shadow-card ring-1 ring-border backdrop-blur-xl dark:bg-surface-dark/97 dark:shadow-card-dark dark:ring-border-dark">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-label={open ? t("map.collapsePanel") : t("map.expandPanel")}
          className="flex min-h-[64px] w-full items-center gap-3 px-4 text-left active:bg-surface-elev dark:active:bg-surface-elev-dark"
        >
          <span className="min-w-0 flex-1">{summary}</span>
          {open ? (
            <ChevronDown className="h-6 w-6 shrink-0 text-muted dark:text-muted-dark" strokeWidth={2} />
          ) : (
            <ChevronUp className="h-6 w-6 shrink-0 text-muted dark:text-muted-dark" strokeWidth={2} />
          )}
        </button>
        {open && (
          <div className="max-h-[52vh] overflow-y-auto border-t border-border px-3 pb-4 pt-3 dark:border-border-dark">
            {children}
          </div>
        )}
      </div>
    </div>
  );
}
