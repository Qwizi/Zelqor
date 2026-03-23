"use client";

import { Skeleton } from "@/components/ui/skeleton";

// Slot counts per section matching SLOT_SECTIONS in the real page
const SECTIONS: { labelWidth: string; slots: number }[] = [
  { labelWidth: "w-20", slots: 4 },  // Jednostki
  { labelWidth: "w-16", slots: 6 },  // Budynki
  { labelWidth: "w-24", slots: 5 },  // Efekty akcji
  { labelWidth: "w-28", slots: 2 },  // Efekty specjalne
  { labelWidth: "w-20", slots: 5 },  // Umiejętności
  { labelWidth: "w-14", slots: 4 },  // Profil
  { labelWidth: "w-14", slots: 2 },  // Audio
];

function SlotSquare() {
  return (
    <Skeleton className="aspect-square rounded-xl border-2 border-dashed border-border/30" />
  );
}

function SectionCard({ labelWidth, slots }: { labelWidth: string; slots: number }) {
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

export function CosmeticsSkeleton() {
  return (
    <div className="space-y-4 md:space-y-6 -mx-4 md:mx-0 -mt-2 md:mt-0">

      {/* Header */}
      <div className="px-4 md:px-0 space-y-1.5">
        <Skeleton className="hidden md:block h-3 w-16" />
        <Skeleton className="h-7 w-32 md:h-12 md:w-40" />
        {/* Equipped count subtitle */}
        <Skeleton className="h-3 w-28 md:h-3.5 md:w-36" />
      </div>

      {/* Section grid — responsive: 1 col → 2 col → 3 col */}
      <div className="px-4 md:px-0 grid grid-cols-1 gap-3 md:gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {SECTIONS.map((s, i) => (
          <SectionCard key={i} labelWidth={s.labelWidth} slots={s.slots} />
        ))}
      </div>
    </div>
  );
}

export default CosmeticsSkeleton;
