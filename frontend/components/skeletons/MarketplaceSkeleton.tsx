"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

const TAB_LABELS = ["browse", "my-listings", "history"] as const;
const TAB_WIDTHS = ["w-20", "w-20", "w-24"];

const CATEGORY_PILL_WIDTHS = ["w-20", "w-24", "w-20", "w-16", "w-24", "w-20"];

function ListingRow() {
  return (
    <div className="flex items-center gap-3 md:gap-4 rounded-xl md:border md:border-border px-1 md:px-4 py-2.5 md:py-3.5">
      {/* Item icon square */}
      <Skeleton className="h-10 w-10 md:h-14 md:w-14 shrink-0 rounded-lg" />

      {/* Name + rarity badge */}
      <div className="flex-1 min-w-0 space-y-1.5">
        <Skeleton className="h-4 w-32 md:w-48 rounded" />
        <div className="flex items-center gap-1">
          <Skeleton className="h-3 w-14 rounded" />
          <Skeleton className="hidden md:block h-3 w-20 rounded" />
        </div>
      </div>

      {/* Price right-aligned */}
      <div className="shrink-0 text-right space-y-1">
        <Skeleton className="h-4 w-14 rounded ml-auto" />
        <Skeleton className="h-3 w-10 rounded ml-auto" />
      </div>

      {/* Chevron */}
      <Skeleton className="h-4 w-4 shrink-0 rounded" />
    </div>
  );
}

export function MarketplaceSkeleton() {
  return (
    <div className="space-y-3 md:space-y-8 -mx-4 md:mx-0 -mt-2 md:mt-0">
      {/* Header */}
      <div className="px-4 md:px-0 space-y-2">
        {/* "RYNEK" eyebrow — desktop only */}
        <Skeleton className="hidden md:block h-3 w-16 rounded" />
        {/* Title */}
        <Skeleton className="h-8 w-24 md:h-12 md:w-40 rounded-lg" />
      </div>

      {/* Wallet */}
      <div className="px-4 md:px-0">
        {/* Mobile: compact inline */}
        <div className="md:hidden flex items-center gap-2.5">
          <Skeleton className="h-5 w-5 rounded" />
          <Skeleton className="h-6 w-16 rounded" />
          <Skeleton className="h-3 w-10 rounded" />
          <Skeleton className="ml-auto h-3 w-20 rounded" />
        </div>

        {/* Desktop: Card */}
        <Card className="hidden md:block rounded-2xl">
          <CardContent className="flex items-center justify-between px-6 py-4">
            <div className="flex items-center gap-3">
              <Skeleton className="h-6 w-6 rounded" />
              <Skeleton className="h-7 w-24 rounded" />
              <Skeleton className="h-5 w-12 rounded" />
            </div>
            <Skeleton className="h-4 w-44 rounded" />
          </CardContent>
        </Card>
      </div>

      {/* Tab pills */}
      <div className="flex gap-1 md:gap-1.5 overflow-x-auto px-4 md:px-0 scrollbar-none">
        {TAB_LABELS.map((_, i) => (
          <Skeleton key={i} className={`shrink-0 h-9 ${TAB_WIDTHS[i]} rounded-full md:rounded-lg`} />
        ))}
      </div>

      {/* Content panel */}
      <div className="px-4 md:px-0">
        <div className="md:rounded-2xl md:border md:border-border md:bg-card md:p-6 space-y-3 md:space-y-4">
          {/* Search bar */}
          <Skeleton className="h-10 md:h-12 w-full rounded-full md:rounded-lg" />

          {/* Category pills — horizontal scroll */}
          <div className="flex gap-1.5 md:gap-2 overflow-x-auto pb-0.5 scrollbar-none lg:hidden">
            {CATEGORY_PILL_WIDTHS.map((w, i) => (
              <Skeleton key={i} className={`shrink-0 h-8 ${w} rounded-full`} />
            ))}
          </div>

          {/* Listing rows */}
          <div className="space-y-1 md:space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <ListingRow key={i} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
