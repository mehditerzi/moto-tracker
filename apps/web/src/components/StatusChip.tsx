import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import { Plus } from "lucide-react";
import type { DatedItem, DatedItemType } from "@mototracker/shared";
import {
  statusFor,
  statusColorClass,
  statusRingClass,
  TYPE_LABEL_TR,
} from "@/lib/datedItems";
import { cn } from "@/lib/cn";

interface Props {
  type: DatedItemType;
  bikeId: string;
  item: DatedItem | null;
}

export function StatusChip({ type, bikeId, item }: Props) {
  const info = statusFor(item?.expiresOn);
  const label = TYPE_LABEL_TR[type];
  const color = statusColorClass(info.status);
  const ring = statusRingClass(info.status);

  const headline = (() => {
    if (info.status === "unset") return "—";
    if (info.daysRemaining === null) return "—";
    if (info.daysRemaining < 0) return "Geçti";
    return info.daysRemaining;
  })();

  const sub = (() => {
    if (info.status === "unset") return "Tarih ekle";
    if (info.daysRemaining === null) return "";
    if (info.daysRemaining < 0) return `${Math.abs(info.daysRemaining)} gün önce`;
    return "gün kaldı";
  })();

  const linkTo = item
    ? `/dated-items/${item.id}`
    : `/bikes/${bikeId}/dated-items/new?type=${type}`;

  return (
    <Link to={linkTo} className="block">
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        whileHover={{ y: -2 }}
        whileTap={{ scale: 0.98 }}
        className={cn(
          "relative flex flex-col gap-1 rounded-xl border p-4 transition",
          color,
          ring,
          info.status === "danger" || info.status === "expired"
            ? "after:pointer-events-none after:absolute after:inset-0 after:rounded-xl after:ring-2 after:ring-danger/0 after:animate-[pulse_1.6s_ease-in-out_infinite]"
            : "",
        )}
      >
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium uppercase tracking-wider opacity-80">
            {label}
          </span>
          {info.status === "unset" && <Plus className="h-3.5 w-3.5 opacity-60" />}
        </div>
        <div className="font-mono text-4xl font-semibold tabular-nums leading-none">
          {headline}
        </div>
        <div className="text-xs opacity-80">
          {sub}
          {item?.expiresOn && info.status !== "unset" && (
            <span className="ml-2 opacity-70">· {item.expiresOn}</span>
          )}
        </div>
      </motion.div>
    </Link>
  );
}
