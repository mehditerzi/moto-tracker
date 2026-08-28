import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Clock, MapPin, Search as SearchIcon, X } from "lucide-react";
import type { CheckpointKind, RidePlace } from "@mototracker/shared";
import { Input } from "@/components/ui/input";
import { CHECKPOINT_KIND_ORDER, CHECKPOINT_META } from "@/components/ride/checkpointMeta";
import type { MapKitSearchResult } from "@/lib/mapkit";

/** Long enough that a stray keystroke doesn't spend a search; short enough to feel live. */
const DEBOUNCE_MS = 420;
const MIN_QUERY = 3;

export interface PickedPlace {
  name: string;
  lat: number;
  lng: number;
  kind: CheckpointKind;
}

/**
 * Adding a stop, in as few taps as the platform allows.
 *
 * The search runs as you type rather than behind a submit button, the kind is
 * chosen *before* the result (so picking a result is the last tap, not the
 * first of three), and everywhere you have been recently is one tap with no
 * typing at all. A rider at a petrol station with gloves on gets "the place I
 * stopped at last week" for a single touch.
 */
export function PlaceSearch({
  open,
  recents,
  onSearch,
  onPick,
  onClose,
}: {
  open: boolean;
  recents: RidePlace[];
  onSearch: (query: string) => Promise<MapKitSearchResult[]>;
  onPick: (place: PickedPlace) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<CheckpointKind>("stop");
  const [results, setResults] = useState<MapKitSearchResult[]>([]);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  // Guards against an early search resolving after a later one and overwriting
  // the newer results — trivially reproducible on a phone connection.
  const seq = useRef(0);

  useEffect(() => {
    if (open) {
      setQuery("");
      setResults([]);
      setFailed(false);
      // The keyboard is the point of opening this panel.
      const id = setTimeout(() => inputRef.current?.focus(), 60);
      return () => clearTimeout(id);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    if (q.length < MIN_QUERY) {
      setResults([]);
      setBusy(false);
      return;
    }
    setBusy(true);
    const mine = ++seq.current;
    const timer = setTimeout(() => {
      onSearch(q)
        .then((places) => {
          if (seq.current !== mine) return;
          setResults(places);
          setFailed(false);
        })
        .catch(() => {
          if (seq.current === mine) setFailed(true);
        })
        .finally(() => {
          if (seq.current === mine) setBusy(false);
        });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query, open, onSearch]);

  if (!open) return null;

  const showRecents = query.trim().length < MIN_QUERY && recents.length > 0;

  return (
    <div className="pointer-events-auto absolute inset-0 z-20 flex flex-col bg-bg/97 pl-safe pr-safe pt-safe backdrop-blur-xl dark:bg-bg-dark/97">
      <div className="flex items-center gap-2 px-3 pb-2">
        <div className="relative flex-1">
          <SearchIcon
            className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted dark:text-muted-dark"
            strokeWidth={1.8}
          />
          <Input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("map.searchPlaceholder")}
            enterKeyHint="search"
            aria-label={t("map.searchPlaceholder")}
            className="h-14 pl-11 text-[17px]"
          />
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={t("common.close")}
          className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-surface-elev text-text ring-1 ring-border dark:bg-surface-elev-dark dark:text-text-dark dark:ring-border-dark"
        >
          <X className="h-6 w-6" strokeWidth={2} />
        </button>
      </div>

      {/* Kind first: the result row below is then the last tap, not the first. */}
      <div className="flex gap-1.5 overflow-x-auto px-3 pb-2">
        {CHECKPOINT_KIND_ORDER.map((k) => {
          const Icon = CHECKPOINT_META[k].icon;
          const on = k === kind;
          return (
            <button
              key={k}
              type="button"
              onClick={() => setKind(k)}
              aria-pressed={on}
              className={`flex h-11 shrink-0 items-center gap-1.5 rounded-full px-4 text-[14px] font-medium ring-1 transition ${
                on
                  ? "bg-text text-bg ring-text dark:bg-text-dark dark:text-bg-dark dark:ring-text-dark"
                  : "bg-surface text-muted ring-border dark:bg-surface-elev-dark dark:text-muted-dark dark:ring-border-dark"
              }`}
            >
              <Icon className="h-4 w-4" strokeWidth={1.9} />
              {t(CHECKPOINT_META[k].labelKey)}
            </button>
          );
        })}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-6">
        {showRecents && (
          <p className="label-micro px-1 pb-1.5 pt-2 text-muted dark:text-muted-dark">
            {t("map.recentPlaces")}
          </p>
        )}
        {showRecents &&
          recents.map((r) => (
            <Row
              key={r.id}
              icon={<Clock className="h-5 w-5 text-muted dark:text-muted-dark" strokeWidth={1.8} />}
              title={r.name}
              onClick={() => onPick({ name: r.name, lat: r.lat, lng: r.lng, kind })}
            />
          ))}

        {!showRecents &&
          results.map((r, i) => (
            <Row
              key={`${r.name ?? ""}-${i}`}
              icon={<MapPin className="h-5 w-5 text-accent-dim" strokeWidth={1.9} />}
              title={r.name ?? r.formattedAddress ?? ""}
              subtitle={r.formattedAddress}
              onClick={() =>
                onPick({
                  name: r.name ?? r.formattedAddress ?? t("map.kinds.stop"),
                  lat: r.coordinate.latitude,
                  lng: r.coordinate.longitude,
                  kind,
                })
              }
            />
          ))}

        {/* Status is spelled out — a rider must never be left guessing whether
            the search is working or simply found nothing. */}
        <p className="px-1 py-6 text-center text-[14px] text-muted dark:text-muted-dark" role="status">
          {failed
            ? t("map.searchFailed")
            : busy
              ? t("map.searching")
              : !showRecents && query.trim().length >= MIN_QUERY && results.length === 0
                ? t("map.searchEmpty")
                : query.trim().length < MIN_QUERY && recents.length === 0
                  ? t("map.searchHint")
                  : ""}
        </p>
      </div>
    </div>
  );
}

function Row({
  icon,
  title,
  subtitle,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-[60px] w-full items-center gap-3 rounded-xl px-3 text-left active:bg-surface-elev dark:active:bg-surface-elev-dark"
    >
      <span className="shrink-0">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[16px] font-medium">{title}</span>
        {subtitle && (
          <span className="block truncate text-[13px] text-muted dark:text-muted-dark">
            {subtitle}
          </span>
        )}
      </span>
    </button>
  );
}
