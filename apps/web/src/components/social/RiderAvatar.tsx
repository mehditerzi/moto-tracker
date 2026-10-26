import { cn } from "@/lib/cn";

const HUES = [78, 160, 200, 260, 330, 20, 45];

/** Initial on a colour derived from the handle — stable, no uploads to moderate. */
export function RiderAvatar({ name, handle, className }: { name: string; handle: string; className?: string }) {
  let h = 0;
  for (const c of handle) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const hue = HUES[h % HUES.length]!;
  return (
    <span
      aria-hidden
      className={cn("grid shrink-0 place-items-center rounded-full font-semibold text-black", className ?? "h-10 w-10 text-[15px]")}
      style={{ background: `linear-gradient(135deg, hsl(${hue} 85% 72%), hsl(${hue} 70% 55%))` }}
    >
      {(name.trim()[0] ?? "?").toLocaleUpperCase("tr-TR")}
    </span>
  );
}
