"use client";

import { cn } from "@/lib/utils";

/**
 * Subtle shimmer overlay shown when TanStack Query is refetching in the background.
 * Wrap around page content — shows a gentle pulse effect without hiding data.
 *
 * @example
 * ```tsx
 * const { data, isLoading, isFetching } = useMyQuery();
 * if (isLoading) return <MySkeleton />;
 * return (
 *   <RefreshingOverlay active={isFetching}>
 *     <ActualContent data={data} />
 *   </RefreshingOverlay>
 * );
 * ```
 */
export function RefreshingOverlay({
  active,
  children,
  className,
}: {
  active: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("relative", className)}>
      {children}
      {active && (
        <div className="pointer-events-none absolute inset-0 z-10 rounded-[inherit] bg-gradient-to-r from-transparent via-primary/[0.03] to-transparent animate-shimmer" />
      )}
    </div>
  );
}
