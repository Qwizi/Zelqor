import { cn } from "@/lib/utils";

interface BannedBadgeProps {
  className?: string;
}

export function BannedBadge({ className }: BannedBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded px-1 py-0.5 text-[9px] font-bold uppercase tracking-wider bg-destructive/15 text-destructive border border-destructive/30 shrink-0",
        className,
      )}
    >
      BAN
    </span>
  );
}
