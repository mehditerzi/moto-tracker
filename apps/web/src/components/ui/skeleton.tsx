import { cn } from "@/lib/cn";

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn(
        "animate-pulse rounded-lg bg-border-strong/20 dark:bg-border/40",
        className,
      )}
    />
  );
}
