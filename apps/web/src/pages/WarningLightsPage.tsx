import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { useTranslation } from "react-i18next";
import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Sheet } from "@/components/share/ShareSheet";
import { BackLink } from "@/components/BackLink";
import { WARNING_LIGHTS, type LightColor, type WarningLight } from "@/lib/warningLights";
import { hapticSelection, hapticTap } from "@/lib/haptics";
import { track } from "@/lib/telemetry";
import { cn } from "@/lib/cn";

const COLORS: (LightColor | "all")[] = ["all", "red", "amber", "green"];

/** The symbol's own colour, on a dark "instrument cluster" tile. */
const INK: Record<LightColor, string> = {
  red: "text-red-500",
  amber: "text-amber-400",
  green: "text-emerald-400",
  blue: "text-sky-400",
};

const BADGE: Record<LightColor, string> = {
  red: "bg-red-500/15 text-red-500",
  amber: "bg-amber-400/15 text-amber-500",
  green: "bg-emerald-400/15 text-emerald-500",
  blue: "bg-sky-400/15 text-sky-500",
};

/** Folds Turkish dotted/dotless i so "yag" finds "yağ" and "Isik" finds "ışık". */
function fold(s: string): string {
  return s
    .toLocaleLowerCase("tr")
    .replace(/[ıi̇]/g, "i")
    .replace(/ğ/g, "g")
    .replace(/ü/g, "u")
    .replace(/ş/g, "s")
    .replace(/ö/g, "o")
    .replace(/ç/g, "c");
}

export function WarningLightsPage() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language.startsWith("en") ? "en" : "tr";
  const [q, setQ] = useState("");
  const [color, setColor] = useState<LightColor | "all">("all");
  const [open, setOpen] = useState<WarningLight | null>(null);

  const list = useMemo(() => {
    const needle = fold(q.trim());
    return WARNING_LIGHTS.filter((l) => {
      // Blue (high beam) sits with green: both are "just information".
      if (color !== "all" && !(l.color === color || (color === "green" && l.color === "blue"))) return false;
      if (!needle) return true;
      return fold(`${l.tr.name} ${l.en.name} ${l.keywords}`).includes(needle);
    });
  }, [q, color]);

  return (
    <div className="flex flex-col gap-4">
      <BackLink to="/assistant" />
      <header>
        <div className="label-micro text-muted dark:text-muted-dark">{t("nav.assistant")}</div>
        <h1 className="mt-1.5 text-[26px] font-semibold leading-none tracking-tight">{t("lights.title")}</h1>
        <p className="mt-2 text-[13.5px] leading-relaxed text-muted dark:text-muted-dark">{t("lights.subtitle")}</p>
      </header>

      <div className="relative">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted dark:text-muted-dark" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t("lights.search")}
          className="pl-10 pr-10"
          aria-label={t("lights.search")}
        />
        {q && (
          <button
            type="button"
            aria-label={t("common.clear", { defaultValue: "×" })}
            onClick={() => setQ("")}
            className="absolute right-2 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-full text-muted dark:text-muted-dark"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      <div role="radiogroup" aria-label={t("lights.filter")} className="flex gap-1.5">
        {COLORS.map((c) => (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={color === c}
            onClick={() => {
              if (color !== c) hapticSelection();
              setColor(c);
            }}
            className={cn(
              "flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12.5px] font-medium ring-1 transition",
              color === c
                ? "bg-text text-bg ring-text dark:bg-text-dark dark:text-bg-dark dark:ring-text-dark"
                : "bg-surface ring-border dark:bg-surface-elev-dark dark:ring-border-dark",
            )}
          >
            {c !== "all" && <span className={cn("h-2 w-2 rounded-full", c === "red" ? "bg-red-500" : c === "amber" ? "bg-amber-400" : "bg-emerald-400")} />}
            {t(`lights.color.${c}`)}
          </button>
        ))}
      </div>

      {list.length === 0 ? (
        <p className="py-10 text-center text-[14px] text-muted dark:text-muted-dark">{t("lights.none")}</p>
      ) : (
        <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-4">
          {list.map((l, i) => (
            <motion.button
              key={l.id}
              type="button"
              layout
              initial={{ opacity: 0, scale: 0.94 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: Math.min(i, 12) * 0.02, duration: 0.2 }}
              whileTap={{ scale: 0.94 }}
              onClick={() => {
                hapticTap();
                setOpen(l);
                track("warning_light_opened", { id: l.id });
              }}
              className="flex flex-col items-center gap-2 rounded-2xl bg-[#0E0F12] p-3 pb-2.5 ring-1 ring-white/5"
            >
              <svg viewBox="0 0 24 24" className={cn("h-10 w-10 drop-shadow-[0_0_6px_currentColor]", INK[l.color])} aria-hidden>
                {l.icon}
              </svg>
              <span className="line-clamp-2 min-h-[2.4em] text-center text-[11.5px] font-medium leading-tight text-white/85">
                {l[lang].name}
              </span>
            </motion.button>
          ))}
        </div>
      )}

      <p className="text-[11.5px] leading-relaxed text-muted dark:text-muted-dark">{t("lights.disclaimer")}</p>

      <Sheet open={!!open} onClose={() => setOpen(null)} title={open?.[lang].name ?? ""}>
        {open && (
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-4">
              <div className="grid h-20 w-20 shrink-0 place-items-center rounded-2xl bg-[#0E0F12]">
                <svg viewBox="0 0 24 24" className={cn("h-12 w-12 drop-shadow-[0_0_8px_currentColor]", INK[open.color])} aria-hidden>
                  {open.icon}
                </svg>
              </div>
              <span className={cn("rounded-full px-2.5 py-1 text-[12px] font-semibold", BADGE[open.color])}>
                {t(`lights.urgency.${open.color === "blue" ? "green" : open.color}`)}
              </span>
            </div>
            <section>
              <h3 className="label-micro text-muted dark:text-muted-dark">{t("lights.meaning")}</h3>
              <p className="mt-1.5 text-[14.5px] leading-relaxed">{open[lang].meaning}</p>
            </section>
            <section className={cn("rounded-2xl p-4", open.color === "red" ? "bg-red-500/10" : "bg-surface dark:bg-surface-elev-dark")}>
              <h3 className="label-micro text-muted dark:text-muted-dark">{t("lights.action")}</h3>
              <p className="mt-1.5 text-[14.5px] font-medium leading-relaxed">{open[lang].action}</p>
            </section>
          </div>
        )}
      </Sheet>
    </div>
  );
}
