"use client";

import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export function LeaderboardSkeleton() {
  return (
    <div className="space-y-3 md:space-y-6 -mx-4 md:mx-0 -mt-2 md:mt-0">
      {/* ── Header ── */}
      <div className="flex items-center justify-between gap-4 px-4 md:px-0">
        <div className="space-y-1.5">
          <Skeleton className="hidden md:block h-3 w-20" />
          <Skeleton className="h-8 w-32 md:h-12 md:w-48" />
          <Skeleton className="hidden md:block h-4 w-64" />
        </div>
        <Skeleton className="hidden md:block h-8 w-24 rounded-full" />
      </div>

      {/* ── My placement banner ── */}
      <div className="px-4 md:px-0">
        <div className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-card p-3.5 md:p-5">
          <div className="flex items-baseline gap-2 md:gap-3">
            <Skeleton className="h-9 w-16 md:h-14 md:w-20" />
            <Skeleton className="h-4 w-28 md:h-5 md:w-36" />
          </div>
          <Skeleton className="h-9 w-20 rounded-full md:rounded-xl" />
        </div>
      </div>

      {/* ── List / Table ── */}
      <div className="px-4 md:px-0">
        {/* Mobile: clean list */}
        <div className="md:hidden space-y-0.5">
          {Array.from({ length: 15 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 rounded-xl py-3 px-1">
              <Skeleton className="h-8 w-8 shrink-0 rounded-lg" />
              <div className="flex-1 min-w-0 space-y-1.5">
                <Skeleton className="h-3.5 w-32" />
                <Skeleton className="h-2.5 w-24" />
              </div>
              <Skeleton className="h-6 w-12 shrink-0" />
              <Skeleton className="h-4 w-4 rounded-sm shrink-0" />
            </div>
          ))}
        </div>

        {/* Desktop: table in Card */}
        <Card className="hidden md:block rounded-2xl overflow-hidden">
          {/* Table header */}
          <div className="flex items-center gap-4 h-12 px-6 border-b border-border">
            <Skeleton className="h-3 w-8" />
            <Skeleton className="h-3 flex-1" />
            <Skeleton className="h-3 w-16 text-center" />
            <Skeleton className="h-3 w-16 text-center" />
            <Skeleton className="h-3 w-16 text-center" />
            <Skeleton className="h-3 w-12 text-center" />
            <Skeleton className="h-3 w-14 ml-auto" />
          </div>
          {/* Table rows */}
          {Array.from({ length: 15 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 px-6 py-3.5 border-b border-border last:border-0">
              <Skeleton className="h-9 w-9 rounded-lg shrink-0" />
              <div className="flex-1 min-w-0">
                <Skeleton className="h-4 w-36" />
              </div>
              <Skeleton className="h-4 w-10 mx-auto" />
              <Skeleton className="h-4 w-10 mx-auto" />
              <Skeleton className="h-4 w-12 mx-auto" />
              <Skeleton className="h-4 w-8 mx-auto" />
              <Skeleton className="h-6 w-16 ml-auto" />
            </div>
          ))}
        </Card>
      </div>

      {/* ── Pagination ── */}
      <div className="flex items-center justify-between px-4 md:px-0">
        <Skeleton className="h-3 w-12" />
        <div className="flex items-center gap-2">
          <Skeleton className="h-9 w-9 md:h-10 md:w-32 rounded-full md:rounded-xl" />
          <Skeleton className="h-9 w-9 md:h-10 md:w-32 rounded-full md:rounded-xl" />
        </div>
      </div>
    </div>
  );
}
