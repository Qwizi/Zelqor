"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

function TableRowSkeleton({ cols }: { cols: string[] }) {
  return (
    <div className="flex items-center gap-4 px-4 py-3.5 border-b border-border/40 last:border-0">
      {cols.map((w, i) => (
        <Skeleton key={i} className={`h-4 ${w}`} />
      ))}
    </div>
  );
}

export function MarketplaceItemSkeleton() {
  return (
    <div className="space-y-3 md:space-y-6 -mx-4 md:mx-0 -mt-2 md:mt-0">
      {/* Back link */}
      <div className="px-4 md:px-0">
        <Skeleton className="h-9 w-40 rounded-lg" />
      </div>

      {/* Item header card */}
      <div className="px-4 md:px-0">
        <Card className="rounded-2xl">
          <CardContent className="flex flex-col gap-4 p-4 sm:flex-row sm:gap-5 sm:p-6">
            {/* Item icon */}
            <Skeleton className="h-20 w-20 shrink-0 rounded-xl" />
            {/* Name + type + rarity */}
            <div className="space-y-2 min-w-0 flex-1">
              <Skeleton className="h-8 w-48 md:w-64" />
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-5 w-20 rounded-full" />
              <Skeleton className="hidden md:block h-4 w-96" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Wallet strip */}
      <div className="px-4 md:px-0">
        <Card className="rounded-xl">
          <CardContent className="flex flex-wrap items-center gap-3 px-4 sm:px-5 py-3.5">
            <Skeleton className="h-5 w-5 rounded" />
            <Skeleton className="h-6 w-16" />
            <Skeleton className="h-4 w-10" />
            <Skeleton className="ml-auto h-4 w-28" />
          </CardContent>
        </Card>
      </div>

      {/* Order books — 2 columns */}
      <div className="px-4 md:px-0 grid gap-4 md:grid-cols-2">
        {["Oferty sprzedaży", "Oferty kupna"].map((_, col) => (
          <div key={col}>
            {/* Section heading */}
            <Skeleton className="h-4 w-36 mb-3" />
            {/* Table */}
            <div className="overflow-hidden rounded-xl border border-border/40">
              {/* Table header */}
              <div className="flex items-center gap-4 bg-muted/30 px-4 py-3 border-b border-border/40">
                <Skeleton className="h-3 flex-1" />
                <Skeleton className="h-3 w-12" />
                <Skeleton className="h-3 w-10" />
                {col === 0 && <Skeleton className="h-3 w-12" />}
              </div>
              {/* 6 rows */}
              {Array.from({ length: 6 }).map((_, i) => (
                <TableRowSkeleton
                  key={i}
                  cols={col === 0 ? ["flex-1", "w-16", "w-12", "w-14"] : ["flex-1", "w-16", "w-12"]}
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Action forms — buy + sell cards */}
      <div className="px-4 md:px-0 grid gap-4 sm:grid-cols-2">
        {/* Quick buy card */}
        <Card className="rounded-xl">
          <CardContent className="p-5 space-y-4">
            <Skeleton className="h-4 w-32" />
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <Skeleton className="h-12 w-full sm:w-24 rounded-lg" />
              <Skeleton className="h-12 flex-1 rounded-lg" />
            </div>
          </CardContent>
        </Card>

        {/* Sell form card */}
        <Card className="rounded-xl">
          <CardContent className="p-5 space-y-4">
            <div className="flex items-center justify-between">
              <Skeleton className="h-4 w-36" />
              <Skeleton className="h-4 w-24" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Skeleton className="h-3 w-10" />
                <Skeleton className="h-12 rounded-lg" />
              </div>
              <div className="space-y-1.5">
                <Skeleton className="h-3 w-16" />
                <Skeleton className="h-12 rounded-lg" />
              </div>
            </div>
            <Skeleton className="h-10 w-full rounded-lg" />
            <Skeleton className="h-12 w-full rounded-lg" />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default MarketplaceItemSkeleton;
