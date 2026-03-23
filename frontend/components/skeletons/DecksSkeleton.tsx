"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";

function MobileDeckRow() {
  return (
    <div className="flex items-center gap-3 rounded-xl py-3 px-1 md:hidden">
      {/* Icon */}
      <Skeleton className="h-11 w-11 shrink-0 rounded-xl" />
      {/* Name + count */}
      <div className="flex-1 space-y-1.5">
        <Skeleton className="h-3.5 w-32" />
        <Skeleton className="h-2.5 w-20" />
      </div>
      {/* Action icons */}
      <Skeleton className="h-8 w-8 shrink-0 rounded-lg" />
      <Skeleton className="h-8 w-8 shrink-0 rounded-lg" />
      <Skeleton className="h-4 w-4 shrink-0 rounded" />
    </div>
  );
}

function DesktopDeckCard() {
  return (
    <Card className="hidden md:block rounded-2xl">
      <CardContent className="p-6">
        <div className="flex items-center gap-5">
          {/* Large icon */}
          <Skeleton className="h-16 w-16 shrink-0 rounded-2xl" />
          {/* Name + count */}
          <div className="flex-1 space-y-2">
            <div className="flex items-center gap-3">
              <Skeleton className="h-6 w-40" />
              <Skeleton className="h-5 w-20 rounded-full" />
            </div>
            <Skeleton className="h-4 w-28" />
          </div>
          {/* Action buttons */}
          <div className="flex items-center gap-2 shrink-0">
            <Skeleton className="h-11 w-24 rounded-xl" />
            <Skeleton className="h-11 w-11 rounded-xl" />
            <Skeleton className="h-11 w-11 rounded-xl" />
          </div>
        </div>

        {/* Item preview row */}
        <div className="mt-5 pt-5 border-t border-border flex gap-3 overflow-x-auto pb-1">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-28 shrink-0 rounded-xl" />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

export function DecksSkeleton() {
  return (
    <div className="space-y-3 md:space-y-8 -mx-4 md:mx-0 -mt-2 md:mt-0">

      {/* Header */}
      <div className="flex items-center justify-between px-4 md:px-0">
        <div className="space-y-1.5">
          <Skeleton className="hidden md:block h-3 w-12" />
          <Skeleton className="h-7 w-20 md:h-12 md:w-24" />
        </div>
        {/* "New deck" button */}
        <Skeleton className="h-10 w-20 md:h-14 md:w-36 rounded-full md:rounded-2xl" />
      </div>

      {/* Deck list */}
      <div className="space-y-1 md:space-y-4 px-4 md:px-0">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i}>
            <MobileDeckRow />
            <DesktopDeckCard />
          </div>
        ))}
      </div>
    </div>
  );
}

export default DecksSkeleton;
