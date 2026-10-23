import { Link } from "react-router-dom";
import { motion, useReducedMotion } from "framer-motion";
import { useTranslation } from "react-i18next";
import {
  ChevronRight,
  Crown,
  FolderLock,
  Lightbulb,
  MapPin,
  Navigation,
  Settings,
  Siren,
  Users,
  Wallet,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { usePaywall } from "@/components/paywall/PaywallContext";
import { useEntitlement } from "@/hooks/useEntitlement";
import { useProAvailable } from "@/hooks/useProAvailable";
import { hapticTap } from "@/lib/haptics";
import { cn } from "@/lib/cn";

interface Tool {
  to: string;
  key: string;
  icon: LucideIcon;
  /** Tile tint — icon colour + a faint wash behind it. */
  tint: string;
  wide?: boolean;
}

const TOOLS: Tool[] = [
  { to: "/costs", key: "costs", icon: Wallet, tint: "text-amber-500 bg-amber-400/10" },
  { to: "/glovebox", key: "glovebox", icon: FolderLock, tint: "text-violet-500 bg-violet-400/10" },
  { to: "/mechanics", key: "mechanics", icon: Wrench, tint: "text-sky-500 bg-sky-400/10" },
  { to: "/nearby", key: "nearby", icon: MapPin, tint: "text-emerald-500 bg-emerald-400/10" },
  { to: "/warning-lights", key: "lights", icon: Lightbulb, tint: "text-orange-500 bg-orange-400/10" },
  { to: "/trips", key: "trips", icon: Navigation, tint: "text-cyan-500 bg-cyan-400/10" },
  { to: "/groups", key: "groups", icon: Users, tint: "text-pink-500 bg-pink-400/10" },
  { to: "/settings", key: "settings", icon: Settings, tint: "text-muted bg-black/5 dark:bg-white/5" },
];

/**
 * Everything around the car that is not a deadline: what it costs, where its
 * papers are, who fixes it, what that light means, and help when it breaks.
 */
export function AssistantPage() {
  const { t } = useTranslation();
  const reduce = useReducedMotion();
  const ent = useEntitlement();
  const { openPaywall } = usePaywall();
  const pro = ent.data?.pro === true;
  const proAvailable = useProAvailable();

  return (
    <div className="flex flex-col gap-5">
      <header>
        <div className="label-micro text-muted dark:text-muted-dark">{t("nav.assistant")}</div>
        <h1 className="mt-1.5 text-[26px] font-semibold leading-none tracking-tight">{t("assistant.title")}</h1>
      </header>

      {/* SOS is not a tile among tiles: it is the one you need fastest. */}
      <motion.div whileTap={{ scale: 0.98 }}>
        <Link
          to="/sos"
          onClick={() => hapticTap()}
          className="flex items-center gap-4 rounded-3xl bg-red-600 p-4 text-white shadow-[0_10px_30px_-12px_rgba(220,38,38,0.55)]"
        >
          <span className="relative grid h-12 w-12 place-items-center rounded-2xl bg-white/15">
            {!reduce && (
              <motion.span
                aria-hidden
                className="absolute inset-0 rounded-2xl bg-white/20"
                animate={{ scale: [1, 1.35], opacity: [0.5, 0] }}
                transition={{ duration: 1.8, repeat: Infinity, ease: "easeOut" }}
              />
            )}
            <Siren className="relative h-6 w-6" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[17px] font-semibold leading-tight">{t("assistant.sos")}</div>
            <div className="text-[12.5px] text-white/85">{t("assistant.sosSub")}</div>
          </div>
          <ChevronRight className="h-5 w-5 text-white/80" />
        </Link>
      </motion.div>

      <div className="grid grid-cols-2 gap-2.5">
        {TOOLS.map((tool, i) => {
          const Icon = tool.icon;
          return (
            <motion.div
              key={tool.to}
              initial={reduce ? false : { opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.035, duration: 0.25, ease: [0.2, 0.8, 0.2, 1] }}
              whileTap={{ scale: 0.96 }}
              className={tool.wide ? "col-span-2" : undefined}
            >
              <Link
                to={tool.to}
                onClick={() => hapticTap()}
                className="flex h-full flex-col gap-3 rounded-2xl bg-surface p-4 ring-1 ring-border transition hover:ring-text/20 dark:bg-surface-elev-dark dark:ring-border-dark"
              >
                <span className={cn("grid h-11 w-11 place-items-center rounded-xl", tool.tint)}>
                  <Icon className="h-[22px] w-[22px]" />
                </span>
                <div>
                  <div className="text-[14.5px] font-semibold leading-tight">{t(`assistant.tools.${tool.key}.title`)}</div>
                  <div className="mt-0.5 text-[12px] leading-snug text-muted dark:text-muted-dark">
                    {t(`assistant.tools.${tool.key}.sub`)}
                  </div>
                </div>
              </Link>
            </motion.div>
          );
        })}
      </div>

      {ent.data && !pro && proAvailable && (
        <motion.button
          type="button"
          whileTap={{ scale: 0.98 }}
          onClick={() => {
            hapticTap();
            openPaywall("generic");
          }}
          className="relative overflow-hidden rounded-3xl bg-[#0E0F12] p-5 text-left text-white ring-1 ring-accent/30"
        >
          <span
            aria-hidden
            className="pointer-events-none absolute -right-10 -top-16 h-44 w-44 rounded-full bg-[radial-gradient(closest-side,rgba(225,255,77,0.35),transparent)]"
          />
          <div className="relative flex items-center gap-3">
            <span className="grid h-11 w-11 place-items-center rounded-xl bg-accent text-black">
              <Crown className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-[16px] font-semibold">{t("pro.title")}</div>
              <div className="text-[12.5px] text-white/70">{t("assistant.proSub")}</div>
            </div>
            <ChevronRight className="h-5 w-5 text-accent" />
          </div>
        </motion.button>
      )}
    </div>
  );
}
