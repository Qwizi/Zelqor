"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";

// Slot counts per section matching SECTION_CONFIG in the real page
const SECTION_SLOTS = [5, 6, 9, 4] as const;
const SECTION_LABELS = ["w-36", "w-20", "w-24", "w-16"] as const;

function SlotSquare() {
  return (
    <Skeleton className="aspect-square rounded-xl border-2 border-dashed border-border/30" />
  );
}

function SectionCard({ slots, labelWidth }: { slots: number; labelWidth: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card overflow-hidden">
      {/* Section header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/60 bg-muted/20">
        <div className="flex items-center gap-2">
          <Skeleton className="h-5 w-5 rounded" />
          <Skeleton className={`h-3.5 ${labelWidth}`} />
        </div>
        <Skeleton className="h-3 w-8" />
      </div>
      {/* Slot grid */}
      <div className="p-3">
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
          {Array.from({ length: slots }).map((_, i) => (
            <SlotSquare key={i} />
          ))}
        </div>
      </div>
    </div>
  );
}

export function DeckEditorSkeleton() {
  return (
    <div className="space-y-4 md:space-y-6 -mx-4 md:mx-0 -mt-2 md:mt-0">

      {/* Header */}
      <div className="px-4 md:px-0 flex items-center gap-3">
        {/* Back button */}
        <Skeleton className="h-9 w-9 md:h-8 md:w-16 shrink-0 rounded-full md:rounded-lg" />
        <div className="flex-1 space-y-1.5">
          <Skeleton className="hidden md:block h-3 w-24" />
          <Skeleton className="h-6 w-36 md:h-8 md:w-52" />
        </div>
        <Skeleton className="h-3 w-12 shrink-0" />
      </div>

      {/* Controls bar */}
      <div className="px-4 md:px-0">
        {/* Mobile controls */}
        <div className="flex items-center gap-2 md:hidden">
          <Skeleton className="h-10 flex-1 rounded-lg" />
          <Skeleton className="h-10 w-10 shrink-0 rounded-full" />
          <Skeleton className="h-10 w-24 shrink-0 rounded-full" />
        </div>

        {/* Desktop controls card */}
        <Card className="hidden md:block rounded-2xl">
          <CardContent className="flex flex-wrap items-center gap-3 px-5 py-4">
            <Skeleton className="h-3 w-12" />
            <Skeleton className="h-11 flex-1 rounded-lg" />
            <Skeleton className="h-11 w-36 rounded-lg" />
            <Skeleton className="h-11 w-24 rounded-xl" />
            <Skeleton className="h-11 w-20 rounded-xl" />
            <Skeleton className="ml-auto h-3 w-24" />
          </CardContent>
        </Card>
      </div>

      {/* Section grid — 2-column on sm+ */}
      <div className="px-4 md:px-0 grid grid-cols-1 gap-3 md:gap-4 sm:grid-cols-2">
        {SECTION_SLOTS.map((slots, i) => (
          <SectionCard key={i} slots={slots} labelWidth={SECTION_LABELS[i]} />
        ))}
      </div>
    </div>
  );
}

export default DeckEditorSkeleton;
