import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { LocateFixed, MapPin, X } from "lucide-react";
import type { RideEventPlace } from "@mototracker/shared";
import { Input } from "@/components/ui/input";
import { usePublicConfig } from "@/hooks/usePublicConfig";
import { loadMapKit, reverseLookupName, type MapKitSearchResult } from "@/lib/mapkit";
import { cn } from "@/lib/cn";

const DEBOUNCE_MS = 380;

/**
 * A meeting point or destination. Type a name and Apple Maps suggests places
 * (picking one stores its coordinates, so riders get one-tap directions); or
 * tap the locate button to use where you are. Free text is fine too — "the
 * usual petrol station" is a real meeting point among friends.
 */
export function PlaceField({
  value,
  onChange,
  placeholder,
  allowLocate = true,
}: {
  value: RideEventPlace | null;
  onChange: (v: RideEventPlace | null) => void;
  placeholder: string;
  allowLocate?: boolean;
}) {
  const { t } = useTranslation();
  const cfg = usePublicConfig();
  const maps = cfg.data?.mapkit ?? false;
  const [text, setText] = useState(value?.name ?? "");
  const [results, setResults] = useState<MapKitSearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [locating, setLocating] = useState(false);
  const seq = useRef(0);
  const typed = useRef(false);

  useEffect(() => {
    if (!typed.current) setText(value?.name ?? "");
  }, [value?.name]);

  useEffect(() => {
    if (!maps || !typed.current) return;
    const q = text.trim();
    if (q.length < 3) {
      setResults([]);
      return;
    }
    const mine = ++seq.current;
    const id = setTimeout(async () => {
      try {
        const mk = await loadMapKit();
        new mk.Search({ language: navigator.language }).search(q, (err, data) => {
          if (mine !== seq.current) return;
          setResults(err ? [] : data.places.slice(0, 6));
          setOpen(true);
        });
      } catch {
        /* search is a convenience; free text still works */
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [text, maps]);

  const pick = (r: MapKitSearchResult) => {
    const name = r.name ?? r.formattedAddress ?? text;
    typed.current = false;
    setText(name);
    setOpen(false);
    setResults([]);
    onChange({ name, lat: r.coordinate.latitude, lng: r.coordinate.longitude });
  };

  const locate = () => {
    if (!navigator.geolocation) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      async (p) => {
        const lat = p.coords.latitude, lng = p.coords.longitude;
        let name: string | null = null;
        if (maps) {
          try {
            name = await reverseLookupName(await loadMapKit(), [lat, lng]);
          } catch {
            name = null;
          }
        }
        typed.current = false;
        const label = name ?? t("rides.form.myLocation");
        setText(label);
        onChange({ name: label, lat, lng });
        setLocating(false);
      },
      () => setLocating(false),
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  };

  return (
    <div className="relative">
      <div className="relative">
        <MapPin className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted dark:text-muted-dark" />
        <Input
          value={text}
          placeholder={placeholder}
          className={cn("pl-10", allowLocate ? "pr-20" : "pr-10")}
          autoComplete="off"
          enterKeyHint="done"
          onFocus={() => results.length && setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onChange={(e) => {
            typed.current = true;
            setText(e.target.value);
            const name = e.target.value.trim();
            onChange(name ? { name, lat: null, lng: null } : null);
          }}
        />
        <div className="absolute right-1.5 top-1/2 flex -translate-y-1/2 items-center">
          {text && (
            <button
              type="button"
              aria-label={t("common.clear")}
              className="grid h-9 w-8 place-items-center text-muted dark:text-muted-dark"
              onClick={() => {
                typed.current = false;
                setText("");
                setResults([]);
                onChange(null);
              }}
            >
              <X className="h-4 w-4" />
            </button>
          )}
          {allowLocate && (
            <button
              type="button"
              aria-label={t("rides.form.useMyLocation")}
              disabled={locating}
              onClick={locate}
              className={cn(
                "grid h-9 w-9 place-items-center rounded-lg text-accent-dim transition hover:bg-surface dark:text-accent dark:hover:bg-surface-elev-dark",
                locating && "animate-pulse",
              )}
            >
              <LocateFixed className="h-[18px] w-[18px]" />
            </button>
          )}
        </div>
      </div>
      {open && results.length > 0 && (
        <ul
          role="listbox"
          className="absolute inset-x-0 top-full z-20 mt-1.5 overflow-hidden rounded-xl border border-border bg-bg shadow-lg dark:border-border-dark dark:bg-surface-elev-dark"
        >
          {results.map((r, i) => (
            <li key={i}>
              <button
                type="button"
                role="option"
                aria-selected={false}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(r)}
                className="flex w-full items-start gap-2.5 px-3.5 py-2.5 text-left transition hover:bg-surface dark:hover:bg-surface-dark"
              >
                <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-muted dark:text-muted-dark" />
                <span className="min-w-0">
                  <span className="block truncate text-[14px] font-medium">{r.name ?? r.formattedAddress}</span>
                  {r.formattedAddress && r.name && (
                    <span className="block truncate text-[12px] text-muted dark:text-muted-dark">{r.formattedAddress}</span>
                  )}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
