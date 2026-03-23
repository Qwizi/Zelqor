"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";

export function DashboardSkeleton() {
  return (
    <div className="space-y-3 md:space-y-6 -mx-4 md:mx-0 -mt-2 md:mt-0">

      {/* ── Header ── */}
      <div className="px-4 md:px-0 space-y-1.5">
        <Skeleton className="hidden md:block h-3 w-24" />
        <Skeleton className="h-8 w-48 md:h-12 md:w-72" />
        <Skeleton className="hidden md:block h-4 w-80" />
      </div>

      {/* ── Stats row ── */}
      <div className="flex gap-3 overflow-x-auto px-4 pb-1 md:px-0 md:grid md:grid-cols-4 md:gap-3 md:overflow-visible scrollbar-none [-ms-overflow-style:none] [scrollbar-width:none]">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="flex shrink-0 items-center gap-3 rounded-2xl bg-card border border-border px-4 py-3 md:flex-col md:items-start md:gap-2 min-w-[140px] md:min-w-0 h-20 md:h-24"
          >
            <div className="flex items-center gap-2">
              <Skeleton className="h-4 w-4 rounded-sm" />
              <Skeleton className="h-2.5 w-14" />
            </div>
            <Skeleton className="h-7 w-16 md:h-9 md:w-20 ml-auto md:ml-0" />
          </div>
        ))}
      </div>

      {/* ── Game config — 3-column on desktop ── */}
      <div className="space-y-4 md:space-y-0 md:grid md:grid-cols-3 md:gap-6 md:items-stretch">

        {/* Left col spans 2 on desktop */}
        <div className="md:col-span-2 md:space-y-6">

          {/* Mode selector card */}
          <div className="px-4 md:px-0">
            {/* Mobile: flat pills */}
            <div className="md:hidden space-y-2.5">
              <Skeleton className="h-2.5 w-16" />
              <div className="flex gap-2 overflow-x-auto pb-0.5 scrollbar-none [-ms-overflow-style:none] [scrollbar-width:none]">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-10 w-28 shrink-0 rounded-full" />
                ))}
              </div>
            </div>
            {/* Desktop: card with large pills */}
            <Card className="hidden md:block rounded-2xl">
              <CardContent className="p-5">
                <Skeleton className="h-3 w-20 mb-4" />
                <div className="flex flex-wrap gap-3">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <Skeleton key={i} className="h-14 w-36 rounded-2xl" />
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Deck + bots card */}
          <div className="px-4 md:px-0">
            {/* Mobile: flat deck pills */}
            <div className="md:hidden space-y-2.5">
              <Skeleton className="h-2.5 w-12" />
              <div className="flex gap-2 overflow-x-auto pb-0.5 scrollbar-none [-ms-overflow-style:none] [scrollbar-width:none]">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-10 w-24 shrink-0 rounded-full" />
                ))}
              </div>
            </div>
            {/* Desktop: card with deck pills + preview squares */}
            <Card className="hidden md:block rounded-2xl">
              <CardContent className="p-5 space-y-5">
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <Skeleton className="h-3 w-16" />
                    <Skeleton className="h-4 w-24" />
                  </div>
                  <div className="flex flex-wrap gap-3">
                    {Array.from({ length: 3 }).map((_, i) => (
                      <Skeleton key={i} className="h-14 w-36 rounded-2xl" />
                    ))}
                  </div>
                </div>
                <div className="border-t border-border" />
                {/* Deck item preview squares */}
                <div className="flex gap-3 overflow-x-auto pb-1">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <Skeleton key={i} className="h-20 w-20 shrink-0 rounded-xl" />
                  ))}
                </div>
                <div className="border-t border-border" />
                {/* Bots grid */}
                <div>
                  <Skeleton className="h-3 w-24 mb-3" />
                  <div className="grid grid-cols-3 gap-3">
                    {Array.from({ length: 3 }).map((_, i) => (
                      <Skeleton key={i} className="h-20 rounded-2xl" />
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Right col: friends panel */}
        <div className="px-4 md:px-0">
          <Card className="hidden md:block rounded-2xl h-full">
            <CardContent className="p-5 space-y-3">
              <div className="flex items-center justify-between">
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-4 w-16" />
              </div>
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3 py-1">
                  <Skeleton className="h-9 w-9 rounded-full shrink-0" />
                  <div className="flex-1 space-y-1.5">
                    <Skeleton className="h-3 w-28" />
                    <Skeleton className="h-2.5 w-16" />
                  </div>
                  <Skeleton className="h-2 w-2 rounded-full shrink-0" />
                </div>
              ))}
            </CardContent>
          </Card>
          {/* Mobile: friends list flat */}
          <div className="md:hidden space-y-2.5">
            <Skeleton className="h-2.5 w-20" />
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 py-1">
                <Skeleton className="h-8 w-8 rounded-full shrink-0" />
                <div className="flex-1 space-y-1">
                  <Skeleton className="h-3 w-24" />
                  <Skeleton className="h-2.5 w-14" />
                </div>
                <Skeleton className="h-2 w-2 rounded-full shrink-0" />
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Play button ── */}
      <div className="px-4 md:px-0">
        <Skeleton className="h-14 w-full rounded-2xl" />
      </div>

      {/* ── Recent matches ── */}
      <div className="px-4 md:px-0">
        <div className="md:rounded-2xl md:border md:border-border md:bg-card md:p-5 space-y-0.5 md:space-y-0">
          <div className="flex items-center justify-between mb-2 md:mb-4">
            <Skeleton className="h-2.5 w-28" />
            <Skeleton className="h-4 w-20 hidden md:block" />
          </div>
          {/* Mobile rows */}
          <div className="md:hidden space-y-0.5">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 py-3 px-1">
                <div className="flex gap-0.5 shrink-0">
                  {Array.from({ length: 4 }).map((_, j) => (
                    <Skeleton key={j} className="h-4 w-4 rounded-md" />
                  ))}
                </div>
                <Skeleton className="h-3 flex-1 max-w-[120px]" />
                <Skeleton className="h-2.5 w-12" />
                <Skeleton className="h-4 w-4 rounded-sm shrink-0" />
              </div>
            ))}
          </div>
          {/* Desktop table rows */}
          <div className="hidden md:block">
            <div className="flex gap-4 py-2.5 border-b border-border">
              {["w-16", "flex-1", "w-20", "w-20", "w-16"].map((w, i) => (
                <Skeleton key={i} className={`h-3 ${w}`} />
              ))}
            </div>
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 py-3.5 border-b border-border last:border-0">
                <Skeleton className="h-4 w-24" />
                <div className="flex gap-1 flex-1">
                  {Array.from({ length: 4 }).map((_, j) => (
                    <Skeleton key={j} className="h-5 w-5 rounded" />
                  ))}
                </div>
                <Skeleton className="h-3 w-16" />
                <Skeleton className="h-3 w-14" />
                <Skeleton className="h-3 w-16" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
