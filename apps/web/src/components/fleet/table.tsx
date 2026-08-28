import { ChevronDown, ChevronUp, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/cn";

/**
 * The dispatch-board table.
 *
 * Density is the one place fleet departs from the consumer app (§6): a manager
 * with 40 vehicles is at a desk, and a phone layout stretched to 1400px is not
 * a fleet tool. So this is a real table from `lg` up — sortable headers with
 * `aria-sort`, `<th scope>` on every heading — and each page renders a card list
 * beside it for narrow screens, where a fleet user is triaging rather than
 * entering data.
 */

export type SortDir = "asc" | "desc";

export function TableShell({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <div className="hidden overflow-x-auto rounded-2xl border border-border bg-surface/70 dark:border-border-dark dark:bg-surface-dark/60 lg:block">
      <table className="w-full border-collapse text-left text-[13px]">
        <caption className="sr-only">{label}</caption>
        {children}
      </table>
    </div>
  );
}

export function Th({
  children,
  className,
  align = "left",
}: {
  children: React.ReactNode;
  className?: string;
  align?: "left" | "right";
}) {
  return (
    <th
      scope="col"
      className={cn(
        "label-micro whitespace-nowrap px-3 py-2.5 text-muted dark:text-muted-dark",
        align === "right" ? "text-right" : "text-left",
        className,
      )}
    >
      {children}
    </th>
  );
}

interface SortableThProps<T extends string> {
  field: T;
  active: T;
  dir: SortDir;
  onSort: (field: T) => void;
  children: React.ReactNode;
  align?: "left" | "right";
  className?: string;
}

/**
 * A sortable column heading.
 *
 * `aria-sort` lives on the `<th>` itself (that is where assistive tech looks for
 * it), and the button carries the accessible action. The arrow is paired with
 * `aria-sort` rather than replacing it, so sort state is never conveyed by a
 * glyph alone.
 */
export function SortableTh<T extends string>({
  field,
  active,
  dir,
  onSort,
  children,
  align = "left",
  className,
}: SortableThProps<T>) {
  const isActive = active === field;
  const Icon = !isActive ? ChevronsUpDown : dir === "asc" ? ChevronUp : ChevronDown;
  return (
    <th
      scope="col"
      aria-sort={isActive ? (dir === "asc" ? "ascending" : "descending") : "none"}
      className={cn("whitespace-nowrap px-3 py-2.5", className)}
    >
      <button
        type="button"
        onClick={() => onSort(field)}
        className={cn(
          "label-micro inline-flex items-center gap-1 rounded transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
          align === "right" ? "flex-row-reverse" : "",
          isActive
            ? "text-text dark:text-text-dark"
            : "text-muted hover:text-text dark:text-muted-dark dark:hover:text-text-dark",
        )}
      >
        {children}
        <Icon className="h-3 w-3 opacity-70" aria-hidden />
      </button>
    </th>
  );
}

export function Tr({
  children,
  onClick,
  className,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  className?: string;
}) {
  return (
    <tr
      onClick={onClick}
      className={cn(
        "border-t border-border/70 dark:border-border-dark/70",
        onClick && "cursor-pointer transition hover:bg-surface-elev/70 dark:hover:bg-surface-elev-dark/60",
        className,
      )}
    >
      {children}
    </tr>
  );
}

export function Td({
  children,
  className,
  align = "left",
}: {
  children: React.ReactNode;
  className?: string;
  align?: "left" | "right";
}) {
  return (
    <td className={cn("px-3 py-2.5", align === "right" ? "text-right" : "", className)}>
      {children}
    </td>
  );
}

/** The card that replaces a row below `lg`. */
export function RowCard({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-2xl border border-border bg-surface/80 p-3.5 pl-4 dark:border-border-dark dark:bg-surface-dark/70",
        className,
      )}
    >
      {children}
    </div>
  );
}
