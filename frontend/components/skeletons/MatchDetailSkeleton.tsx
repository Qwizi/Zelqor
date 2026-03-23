"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";

function PlayerRowSkeleton() {
  return (
    <div className="flex items-center gap-3 py-3 px-1 md:hidden">
      {/* Color swatch */}
      <Skeleton className="h-8 w-8 shrink-0 rounded-lg" />
      <div className="flex-1 space-y-1.5">
        <Skeleton className="h-3.5 w-32" />
        <Skeleton className="h-2.5 w-20" />
      </div>
      {/* ELO delta */}
      <Skeleton className="h-4 w-10 shrink-0" />
      <Skeleton className="h-4 w-4 shrink-0 rounded" />
    </div>
  );
}

function DesktopTableRowSkeleton() {
  return (
    <div className="hidden md:flex items-center gap-4 px-6 py-4 border-b border-border last:border-0">
      {/* Player cell: color + name */}
      <div className="flex items-center gap-3 flex-[2]">
        <Skeleton className="h-8 w-8 shrink-0 rounded-lg" />
        <Skeleton className="h-4 w-32" />
      </div>
      {/* Status */}
      <Skeleton className="h-5 w-20 rounded-full flex-1" />
      {/* Placement */}
      <Skeleton className="h-6 w-8 flex-1" />
      {/* Regions */}
      <Skeleton className="h-4 w-10 flex-1" />
      {/* Units */}
      <Skeleton className="h-4 w-10 flex-1" />
      {/* Losses */}
      <Skeleton className="h-4 w-10 flex-1" />
      {/* Buildings */}
      <Skeleton className="h-4 w-10 flex-1" />
      {/* ELO */}
      <Skeleton className="h-5 w-14 flex-1 text-right" />
    </div>
  );
}

export function MatchDetailSkeleton() {
  return (
    <div className="space-y-3 md:space-y-8 -mx-4 md:mx-0 -mt-2 md:mt-0">

      {/* Header */}
      <div className="px-4 md:px-0 space-y-2">
        <div className="flex items-center gap-2">
          {/* Back button */}
          <Skeleton className="h-9 w-9 rounded-full md:h-auto md:w-auto md:rounded-lg md:px-8 md:py-2 shrink-0" />
          {/* "Mecz" title — mobile only */}
          <Skeleton className="h-6 w-16 md:hidden" />
        </div>
        {/* Desktop large title */}
        <Skeleton className="hidden md:block h-12 w-72" />
        {/* Action buttons */}
        <div className="flex gap-2 mt-3 md:mt-4">
          <Skeleton className="h-9 w-24 md:h-12 md:w-28 rounded-full md:rounded-2xl" />
          <Skeleton className="h-9 w-20 md:h-12 md:w-32 rounded-full md:rounded-2xl" />
        </div>
      </div>

      {/* Stat cards — horizontal scroll on mobile, grid on desktop */}
      <div className="flex gap-2.5 overflow-x-auto px-4 pb-1 md:px-0 md:grid md:grid-cols-2 lg:grid-cols-4 md:gap-4 md:overflow-visible scrollbar-none [-ms-overflow-style:none] [scrollbar-width:none]">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="flex shrink-0 items-center gap-2.5 rounded-2xl bg-card/60 md:bg-card border border-transparent md:border-border px-3.5 py-3 md:p-5 md:flex-col md:items-start md:gap-2 min-w-[120px] md:min-w-0"
          >
            <Skeleton className="h-4 w-4 md:h-5 md:w-5 rounded" />
            <Skeleton className="h-2.5 w-12 md:h-3 md:w-16" />
            <Skeleton className="h-5 w-20 md:h-8 md:w-28 ml-auto md:ml-0" />
          </div>
        ))}
      </div>

      {/* Timestamps row */}
      <div className="flex flex-wrap gap-3 md:gap-6 px-4 md:px-0">
        <Skeleton className="h-3 w-36" />
        <Skeleton className="h-3 w-36" />
      </div>

      {/* MVP + ELO cards */}
      <div className="px-4 md:px-0 space-y-3 md:space-y-4">
        {/* MVP banner */}
        <div className="flex items-center gap-3 md:gap-4 rounded-2xl border border-border bg-card/50 p-3 md:p-4">
          <Skeleton className="h-10 w-10 md:h-12 md:w-12 shrink-0 rounded-xl" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-2.5 w-16" />
            <Skeleton className="h-5 w-28" />
          </div>
          <div className="flex gap-4 shrink-0">
            <div className="space-y-1 text-center">
              <Skeleton className="h-5 w-8 mx-auto" />
              <Skeleton className="h-2 w-12" />
            </div>
            <div className="space-y-1 text-center">
              <Skeleton className="h-5 w-8 mx-auto" />
              <Skeleton className="h-2 w-12" />
            </div>
            <div className="space-y-1 text-center">
              <Skeleton className="h-5 w-8 mx-auto" />
              <Skeleton className="h-2 w-12" />
            </div>
          </div>
        </div>

        {/* ELO + stats-per-min cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="rounded-2xl border border-border bg-card/50 md:bg-card p-3 md:p-4">
              <Skeleton className="h-2.5 w-24 mb-3" />
              <div className="space-y-2.5">
                {Array.from({ length: 4 }).map((_, j) => (
                  <div key={j} className="flex items-center gap-2.5">
                    <Skeleton className="h-4 w-4 rounded-md shrink-0" />
                    <Skeleton className="h-3 flex-1" />
                    <Skeleton className="h-4 w-12 shrink-0" />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Players section */}
      <div className="px-4 md:px-0">
        {/* Mobile section label */}
        <Skeleton className="h-2.5 w-16 mb-2 md:hidden" />

        {/* Mobile: card rows */}
        <div className="md:hidden space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <PlayerRowSkeleton key={i} />
          ))}
        </div>

        {/* Desktop: table card */}
        <Card className="hidden md:block rounded-2xl overflow-hidden">
          <div className="flex items-center gap-3 px-6 pt-5 pb-3">
            <Skeleton className="h-6 w-6 rounded" />
            <Skeleton className="h-7 w-24" />
          </div>
          {/* Table header */}
          <div className="flex items-center gap-4 px-6 py-3 border-y border-border bg-muted/20">
            {["flex-[2]", "flex-1", "flex-1", "flex-1", "flex-1", "flex-1", "flex-1", "flex-1"].map((w, i) => (
              <Skeleton key={i} className={`h-3 ${w}`} />
            ))}
          </div>
          {/* 4 player rows */}
          {Array.from({ length: 4 }).map((_, i) => (
            <DesktopTableRowSkeleton key={i} />
          ))}
        </Card>
      </div>

      {/* Share button */}
      <div className="px-4 md:px-0">
        <Skeleton className="h-10 w-32 rounded-full" />
      </div>
    </div>
  );
}

export default MatchDetailSkeleton;
