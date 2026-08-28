import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronUp, X } from "lucide-react";
import type { CheckpointKind, RidePlace } from "@mototracker/shared";
import { CHECKPOINT_KIND_ORDER, CHECKPOINT_META } from "@/components/ride/checkpointMeta";

/**
 * The planned route as a list of checkpoints.
 *
 * Reordering is two explicit arrow buttons, not drag-and-drop. That is a
 * deliberate downgrade: dragging a row inside a scrolling sheet that sits on
 * top of a pannable map is fiddly with bare hands and hopeless with gloves,
 * while a 44px arrow is a target you can hit at a red light without looking.
 */
export function StopList({
  stops,
  onMove,
  onRemove,
  onKind,
}: {
  stops: RidePlace[];
  onMove: (id: string, dir: -1 | 1) => void;
  onRemove: (id: string) => void;
  onKind: (id: string, kind: CheckpointKind) => void;
}) {
  const { t } = useTranslation();

  return (
    <ol className="flex flex-col gap-1.5">
      {stops.map((s, i) => {
        const Icon = CHECKPOINT_META[s.kind].icon;
        return (
          <li
            key={s.id}
            className="flex items-center gap-2 rounded-xl bg-surface p-2 ring-1 ring-border dark:bg-surface-elev-dark dark:ring-border-dark"
          >
            <span
              aria-hidden
              className="num flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface-elev text-[15px] font-semibold dark:bg-surface-dark"
            >
              {i + 1}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[15px] font-medium">{s.name}</span>
              {/* Kind cycles in place: one tap, no menu, no modal. */}
              <button
                type="button"
                onClick={() => onKind(s.id, nextKind(s.kind))}
                className="mt-0.5 inline-flex min-h-[28px] items-center gap-1 rounded-md pr-1 text-[13px] text-muted dark:text-muted-dark"
                aria-label={t("map.changeKind", { name: s.name })}
              >
                <Icon className="h-4 w-4" strokeWidth={1.9} />
                {t(CHECKPOINT_META[s.kind].labelKey)}
              </button>
            </span>
            <span className="flex shrink-0 items-center">
              <IconButton
                label={t("map.moveUp", { n: i + 1 })}
                disabled={i === 0}
                onClick={() => onMove(s.id, -1)}
              >
                <ChevronUp className="h-5 w-5" strokeWidth={2.1} />
              </IconButton>
              <IconButton
                label={t("map.moveDown", { n: i + 1 })}
                disabled={i === stops.length - 1}
                onClick={() => onMove(s.id, 1)}
              >
                <ChevronDown className="h-5 w-5" strokeWidth={2.1} />
              </IconButton>
              <IconButton label={t("map.removeStop", { name: s.name })} onClick={() => onRemove(s.id)}>
                <X className="h-5 w-5 text-danger" strokeWidth={2.1} />
              </IconButton>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function nextKind(kind: CheckpointKind): CheckpointKind {
  const i = CHECKPOINT_KIND_ORDER.indexOf(kind);
  return CHECKPOINT_KIND_ORDER[(i + 1) % CHECKPOINT_KIND_ORDER.length]!;
}

function IconButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="flex h-11 w-11 items-center justify-center rounded-lg text-text transition active:bg-surface-elev disabled:opacity-25 dark:text-text-dark dark:active:bg-surface-dark"
    >
      {children}
    </button>
  );
}
