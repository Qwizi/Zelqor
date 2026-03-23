"use client";

import { Skeleton } from "@/components/ui/skeleton";

export function ProfileSkeleton() {
  return (
    <div className="space-y-3 md:space-y-6 -mx-4 md:mx-0 -mt-2 md:mt-0">

      {/* ── Header ── */}
      <div className="flex items-center gap-2 px-4 md:px-0">
        <div className="flex-1 min-w-0 space-y-1.5">
          <Skeleton className="hidden md:block h-3 w-16" />
          <Skeleton className="h-8 w-40 md:h-9 md:w-56" />
        </div>
        {/* Settings / action button placeholder */}
        <Skeleton className="h-9 w-9 rounded-full shrink-0" />
      </div>

      {/* ── Identity card: avatar + username + ELO badge + stats ── */}
      <div className="px-4 md:px-0">
        <div className="md:rounded-2xl md:border md:border-border md:bg-card md:p-5">
          {/* Avatar row */}
          <div className="flex items-center gap-3 md:gap-4">
            <Skeleton className="h-12 w-12 md:h-16 md:w-16 rounded-2xl shrink-0" />
            <div className="flex-1 min-w-0 space-y-2">
              <div className="flex items-center gap-2">
                <Skeleton className="h-6 w-36 md:h-7 md:w-48" />
                <Skeleton className="h-4 w-10" />
              </div>
              <Skeleton className="h-3 w-44 hidden md:block" />
            </div>
            {/* Gold — desktop only */}
            <Skeleton className="hidden md:block h-6 w-20" />
          </div>

          {/* Stats grid — horizontal scroll on mobile, grid-cols-4 on desktop */}
          <div className="flex gap-2 mt-3 md:mt-5 overflow-x-auto pb-0.5 md:grid md:grid-cols-4 md:gap-3 md:overflow-visible scrollbar-none [-ms-overflow-style:none] [scrollbar-width:none]">
            {[
              { labelW: "w-8" },
              { labelW: "w-12" },
              { labelW: "w-14" },
              { labelW: "w-16" },
            ].map(({ labelW }, i) => (
              <div
                key={i}
                className="flex shrink-0 items-center gap-2.5 rounded-xl bg-secondary/50 border border-border px-3 py-2 md:p-4 md:flex-col md:items-start md:gap-1.5 min-w-[100px] md:min-w-0"
              >
                <Skeleton className={`h-2.5 ${labelW}`} />
                <Skeleton className="h-5 w-14 md:h-9 md:w-20 ml-auto md:ml-0" />
              </div>
            ))}
          </div>

          {/* Extra stats line */}
          <Skeleton className="mt-3 h-3 w-40" />
        </div>
      </div>

      {/* ── Match history ── */}
      <div className="px-4 md:px-0">
        <div className="md:rounded-2xl md:border md:border-border md:bg-card md:p-5">
          <div className="flex items-center justify-between mb-2 md:mb-4">
            <Skeleton className="h-2.5 w-28" />
            <Skeleton className="h-4 w-20 hidden md:block" />
          </div>

          {/* Mobile rows */}
          <div className="md:hidden space-y-0.5">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 rounded-xl py-2.5 px-1">
                <div className="flex gap-0.5 shrink-0">
                  {Array.from({ length: 4 }).map((_, j) => (
                    <Skeleton key={j} className="h-4 w-4 rounded-md" />
                  ))}
                </div>
                <Skeleton className="h-3 flex-1 max-w-[100px]" />
                <Skeleton className="h-2.5 w-16" />
                <Skeleton className="h-3.5 w-3.5 rounded-sm shrink-0" />
              </div>
            ))}
          </div>

          {/* Desktop table */}
          <div className="hidden md:block">
            <div className="flex gap-4 py-2.5 border-b border-border">
              {["w-24", "w-20", "w-16", "w-20", "w-24"].map((w, i) => (
                <Skeleton key={i} className={`h-3 ${w} ${i > 2 ? "ml-auto" : ""}`} />
              ))}
            </div>
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 py-2.5 border-b border-border last:border-0">
                <div className="flex items-center gap-2">
                  <div className="flex gap-0.5">
                    {Array.from({ length: 4 }).map((_, j) => (
                      <Skeleton key={j} className="h-5 w-5 rounded" />
                    ))}
                  </div>
                  <Skeleton className="h-4 w-20" />
                </div>
                <Skeleton className="h-3 w-16" />
                <Skeleton className="h-3 w-10" />
                <Skeleton className="h-3 w-16 ml-auto" />
                <Skeleton className="h-3 w-20" />
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Inventory preview ── */}
      <div className="px-4 md:px-0">
        <div className="md:rounded-2xl md:border md:border-border md:bg-card md:p-5">
          <div className="flex items-center justify-between mb-2 md:mb-4">
            <Skeleton className="h-2.5 w-20" />
            <Skeleton className="h-4 w-16 hidden md:block" />
          </div>
          <div className="grid grid-cols-4 gap-1.5 md:grid-cols-8 md:gap-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="aspect-square md:aspect-auto md:h-20 rounded-xl" />
            ))}
          </div>
        </div>
      </div>

      {/* ── Decks section ── */}
      <div className="px-4 md:px-0">
        <div className="md:rounded-2xl md:border md:border-border md:bg-card md:p-5 space-y-3">
          <div className="flex items-center justify-between mb-2 md:mb-4">
            <Skeleton className="h-2.5 w-24" />
            <Skeleton className="h-4 w-20 hidden md:block" />
          </div>
          {/* Deck cards */}
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="rounded-xl border border-border bg-secondary/50 p-3 md:p-4 space-y-2.5 md:space-y-3">
              <div className="flex items-center gap-2.5 md:gap-3">
                <Skeleton className="h-4 w-4 md:h-5 md:w-5 rounded-sm shrink-0" />
                <Skeleton className="h-4 w-32 md:h-5 md:w-44" />
                <Skeleton className="h-5 w-16 rounded-full ml-auto" />
              </div>
              <div className="flex flex-wrap gap-1.5 md:gap-2">
                {Array.from({ length: 4 }).map((_, j) => (
                  <Skeleton key={j} className="h-6 w-20 rounded-full" />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
