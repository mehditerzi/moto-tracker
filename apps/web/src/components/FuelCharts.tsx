import { useTranslation } from "react-i18next";
import { Card, CardContent } from "@/components/ui/card";
import type { EconomyPoint, MonthSpend } from "@/lib/fuelEconomy";

// Hand-rolled SVG charts — deliberately no charting dependency. Everything is
// sized in a fixed viewBox and stretched to the card width, so there's no
// resize measurement or layout effect involved.

const W = 320;
const H = 96;
const PAD_TOP = 14; // room for the value labels above bars / points

function monthLabel(month: string, locale: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Intl.DateTimeFormat(locale, { month: "short" }).format(new Date(y!, m! - 1, 1));
}

/** Trailing-months fuel spend as bars; value labels only where there's spend. */
export function MonthlySpendChart({ months }: { months: MonthSpend[] }) {
  const { t, i18n } = useTranslation();
  if (months.every((m) => m.total <= 0)) return null;
  const max = Math.max(...months.map((m) => m.total));
  const slot = W / months.length;
  const barW = Math.min(28, slot * 0.55);

  return (
    <Card>
      <CardContent className="flex flex-col gap-2 p-4">
        <span className="text-[13px] text-muted dark:text-muted-dark">{t("fuel.spendByMonth")}</span>
        <svg viewBox={`0 0 ${W} ${H + 14}`} className="w-full" role="img" aria-label={t("fuel.spendByMonth")}>
          {months.map((m, i) => {
            const h = max > 0 ? ((H - PAD_TOP) * m.total) / max : 0;
            const x = i * slot + (slot - barW) / 2;
            return (
              <g key={m.month}>
                <rect
                  x={x}
                  y={H - h}
                  width={barW}
                  height={Math.max(h, m.total > 0 ? 2 : 0)}
                  rx={3}
                  className="fill-accent"
                  opacity={0.85}
                />
                {m.total > 0 && (
                  <text
                    x={i * slot + slot / 2}
                    y={H - h - 4}
                    textAnchor="middle"
                    className="fill-current text-muted dark:text-muted-dark"
                    fontSize={9}
                  >
                    ₺{Math.round(m.total).toLocaleString()}
                  </text>
                )}
                <text
                  x={i * slot + slot / 2}
                  y={H + 11}
                  textAnchor="middle"
                  className="fill-current text-muted dark:text-muted-dark"
                  fontSize={9}
                >
                  {monthLabel(m.month, i18n.language)}
                </text>
              </g>
            );
          })}
        </svg>
      </CardContent>
    </Card>
  );
}

/** L/100km per tank-to-tank segment, oldest → newest. Needs ≥ 2 points. */
export function EconomyTrendChart({ points }: { points: EconomyPoint[] }) {
  const { t } = useTranslation();
  if (points.length < 2) return null;
  const values = points.map((p) => p.l100);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const x = (i: number) => (i / (points.length - 1)) * (W - 16) + 8;
  const y = (v: number) => PAD_TOP + (1 - (v - min) / span) * (H - PAD_TOP - 8);
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.l100).toFixed(1)}`).join(" ");
  const last = points[points.length - 1]!;

  return (
    <Card>
      <CardContent className="flex flex-col gap-2 p-4">
        <div className="flex items-baseline justify-between">
          <span className="text-[13px] text-muted dark:text-muted-dark">{t("fuel.economyTrend")}</span>
          <span className="num text-[13px] font-semibold">{last.l100.toFixed(1)} L/100km</span>
        </div>
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={t("fuel.economyTrend")}>
          <path d={path} fill="none" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" className="stroke-accent" />
          {points.map((p, i) => (
            <circle key={`${p.date}-${i}`} cx={x(i)} cy={y(p.l100)} r={i === points.length - 1 ? 3.5 : 2} className="fill-accent" />
          ))}
        </svg>
      </CardContent>
    </Card>
  );
}
