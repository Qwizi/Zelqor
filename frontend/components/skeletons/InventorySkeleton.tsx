"use client";

import { Skeleton } from "@/components/ui/skeleton";

const TAB_WIDTHS = ["w-20", "w-14", "w-24", "w-12", "w-24"];
const CATEGORY_PILL_WIDTHS = ["w-20", "w-24", "w-28", "w-20", "w-24", "w-16", "w-16", "w-20"];

export function InventorySkeleton() {
  return (
    <div className="space-y-3 md:space-y-6 -mx-4 md:mx-0 -mt-2 md:mt-0">

      {/* Header */}
      <div className="px-4 md:px-0 space-y-2">
        {/* "EKWIPUNEK" eyebrow — desktop only */}
        <Skeleton className="hidden md:block h-3 w-24 rounded" />
        {/* Title */}
        <Skeleton className="h-8 w-36 md:h-12 md:w-52 rounded-lg" />
        {/* Subtitle — desktop only */}
        <Skeleton className="hidden md:block h-4 w-72 rounded" />
      </div>

      {/* Wallet bar */}
      <div className="px-4 md:px-0">
        {/* Mobile: compact inline */}
        <div className="md:hidden flex items-center gap-2.5">
          <Skeleton className="h-5 w-5 rounded" />
          <Skeleton className="h-6 w-16 rounded" />
          <Skeleton className="h-3 w-10 rounded" />
        </div>

        {/* Desktop: pill-style wallet row */}
        <div className="hidden md:flex items-center gap-3">
          <Skeleton className="h-6 w-6 rounded" />
          <Skeleton className="h-7 w-24 rounded" />
          <Skeleton className="h-4 w-10 rounded" />
        </div>
      </div>

      {/* Tab pills */}
      <div className="px-4 md:px-0">
        {/* Mobile: horizontal scroll pills */}
        <div className="md:hidden flex gap-1.5 overflow-x-auto pb-1 scrollbar-none">
          {TAB_WIDTHS.map((w, i) => (
            <Skeleton key={i} className={`shrink-0 h-9 ${w} rounded-full`} />
          ))}
        </div>

        {/* Desktop: standard tab list */}
        <Skeleton className="hidden md:block h-10 w-96 rounded-lg mb-4" />
      </div>

      {/* Filters: search + category pills */}
      <div className="px-4 md:px-0 space-y-3">
        {/* Search input */}
        <Skeleton className="h-10 w-full rounded-full md:rounded-lg" />

        {/* Category pills row */}
        <div className="flex gap-1.5 md:gap-2 overflow-x-auto pb-0.5 scrollbar-none">
          {CATEGORY_PILL_WIDTHS.map((w, i) => (
            <Skeleton key={i} className={`shrink-0 h-8 ${w} rounded-full`} />
          ))}
        </div>
      </div>

      {/* Item grid */}
      <div className="px-4 md:px-0">
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-1.5 md:gap-2">
          {Array.from({ length: 24 }).map((_, i) => (
            <Skeleton
              key={i}
              className="aspect-square rounded-xl border border-border/30"
            />
          ))}
        </div>
      </div>
    </div>
  );
}
