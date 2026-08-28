import * as React from "react";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/cn";
import { useFieldControl } from "@/components/ui/field";
import { controlClasses, type ControlSize } from "@/components/ui/control";

export interface ComboboxProps {
  value: string;
  onChange: (value: string) => void;
  /** Async option source (e.g. catalog search). Receives the current query. */
  fetchOptions?: (query: string) => Promise<string[]>;
  /** Static option source. Used when `fetchOptions` is absent. */
  options?: string[];
  placeholder?: string;
  /** Allow free-typed values not in the list (default true). Keeps OCR/odd values usable. */
  allowCustom?: boolean;
  disabled?: boolean;
  id?: string;
  /** Control scale — see ui/control.ts. */
  controlSize?: ControlSize;
  inputClassName?: string;
  emptyText?: string;
  /** Auto-uppercase the typed/selected value (plates, codes). */
  uppercase?: boolean;
}

/**
 * Tap-first searchable select. Behaves like a normal text field — typing
 * updates the value immediately (so a custom value is never lost) — but surfaces
 * matching catalog options the moment you focus or type, so the common path is
 * "tap field → tap option" with zero typing. Hand-rolled (no extra dep) and
 * WebView-safe for the Capacitor wrap.
 */
export function Combobox({
  value,
  onChange,
  fetchOptions,
  options: staticOptions,
  placeholder,
  allowCustom = true,
  disabled,
  id,
  controlSize = "md",
  inputClassName,
  emptyText,
  uppercase,
}: ComboboxProps) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [items, setItems] = React.useState<string[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [active, setActive] = React.useState(0);
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const reqId = React.useRef(0);

  // Inside a <Field> the id and the error wiring come from the field; an
  // explicit `id` prop still wins.
  const { id: fieldId, ...fieldAria } = useFieldControl();
  const controlId = id ?? fieldId;
  const listId = controlId ? `${controlId}-list` : undefined;

  const norm = React.useCallback((s: string) => (uppercase ? s.toUpperCase() : s), [uppercase]);

  /**
   * Both option sources are read through refs, and neither is a dependency of
   * the resolver effect below.
   *
   * Call sites pass them inline — `fetchOptions={(q) => fetchMakes(q, type)}`,
   * `options={yearOptions()}` — so both get a new identity on every render of
   * the *parent*. As dependencies that was two separate bugs: the async source
   * restarted its 180 ms debounce and bumped `reqId` (discarding a response
   * already in flight) on every unrelated parent re-render, and the static
   * source ran `setItems(newArray)` on every render, which re-rendered the
   * parent, which built another array — an unbounded render loop for as long
   * as the list was open. The effect only ever needs to re-run when the list
   * opens or the query changes; a caller swapping its option source while the
   * list is open is not a thing that happens.
   */
  const fetchRef = React.useRef(fetchOptions);
  const staticRef = React.useRef(staticOptions);
  React.useEffect(() => {
    fetchRef.current = fetchOptions;
    staticRef.current = staticOptions;
  });

  // Resolve options for the current query (debounced for the async source).
  React.useEffect(() => {
    if (!open) return;
    const statics = staticRef.current;
    if (statics) {
      const q = query.trim().toLowerCase();
      setItems(q ? statics.filter((o) => o.toLowerCase().includes(q)) : statics);
      return;
    }
    const fetcher = fetchRef.current;
    if (!fetcher) return;
    const myId = ++reqId.current;
    setLoading(true);
    const handle = setTimeout(() => {
      fetcher(query.trim())
        .then((res) => {
          if (myId === reqId.current) setItems(res);
        })
        .catch(() => {
          if (myId === reqId.current) setItems([]);
        })
        .finally(() => {
          if (myId === reqId.current) setLoading(false);
        });
    }, 180);
    return () => clearTimeout(handle);
  }, [open, query]);

  // Close on outside pointer.
  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", onDown);
    return () => window.removeEventListener("pointerdown", onDown);
  }, [open]);

  const openList = () => {
    if (disabled) return;
    setQuery("");
    setActive(0);
    setOpen(true);
  };

  const select = (v: string) => {
    onChange(norm(v));
    setOpen(false);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open && (e.key === "ArrowDown" || e.key === "Enter")) {
      openList();
      return;
    }
    if (!open) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, items.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (items[active]) select(items[active]!);
      else if (allowCustom) setOpen(false);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  // Input shows the committed value when closed, the live query when open.
  const shown = open ? query : value;

  return (
    <div ref={rootRef} className="relative">
      <div className="relative">
        <input
          id={controlId}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          {...fieldAria}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          disabled={disabled}
          value={shown}
          placeholder={placeholder}
          onFocus={openList}
          onChange={(e) => {
            const v = norm(e.target.value);
            setQuery(v);
            if (!open) setOpen(true);
            if (allowCustom) onChange(v); // free text commits live — never blocks a custom value
          }}
          onKeyDown={onKeyDown}
          // One control recipe for input / select / combobox — see ui/control.ts.
          className={cn(controlClasses(controlSize), "pr-9", inputClassName)}
        />
        <button
          type="button"
          tabIndex={-1}
          aria-hidden
          disabled={disabled}
          onClick={() => (open ? setOpen(false) : openList())}
          className="absolute inset-y-0 right-0 flex w-9 items-center justify-center text-muted dark:text-muted-dark"
        >
          <ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} />
        </button>
      </div>

      {open && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-30 mt-1 max-h-60 w-full overflow-auto rounded-xl border border-border bg-surface py-1 shadow-lg dark:border-border-dark dark:bg-surface-elev-dark"
        >
          {loading && items.length === 0 && (
            <li className="px-3.5 py-2 text-sm text-muted dark:text-muted-dark">…</li>
          )}
          {!loading && items.length === 0 && (
            <li className="px-3.5 py-2 text-sm text-muted dark:text-muted-dark">
              {emptyText ?? (query ? query : "—")}
            </li>
          )}
          {items.map((opt, i) => {
            const selected = opt === value;
            return (
              <li key={opt} role="option" aria-selected={selected}>
                <button
                  type="button"
                  onPointerDown={(e) => {
                    e.preventDefault(); // keep focus, fire before outside-close
                    select(opt);
                  }}
                  onMouseEnter={() => setActive(i)}
                  className={cn(
                    "flex w-full items-center justify-between gap-2 px-3.5 py-2.5 text-left text-[15px]",
                    i === active ? "bg-accent/10 dark:bg-accent/15" : "",
                  )}
                >
                  <span>{opt}</span>
                  {selected && <Check className="h-4 w-4 text-accent" />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
