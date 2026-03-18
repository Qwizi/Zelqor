"use client";

import type { ReactNode } from "react";
import { useSystemModules } from "@/hooks/useSystemModules";

interface ModuleGateProps {
  /** System module slug to check. */
  slug: string;
  /** Content to render when module is enabled. */
  children: ReactNode;
  /** Optional content when module is disabled. Defaults to null (hidden). */
  fallback?: ReactNode;
}

/**
 * Conditionally renders children based on system module state.
 *
 * Usage:
 *   <ModuleGate slug="shop">
 *     <ShopSection />
 *   </ModuleGate>
 *
 *   <ModuleGate slug="marketplace" fallback={<p>Marketplace is disabled</p>}>
 *     <MarketplaceList />
 *   </ModuleGate>
 */
export function ModuleGate({ slug, children, fallback = null }: ModuleGateProps) {
  const { isEnabled } = useSystemModules();

  if (!isEnabled(slug)) {
    return <>{fallback}</>;
  }

  return <>{children}</>;
}

/**
 * Full-page fallback shown when navigating to a disabled module's page.
 */
export function ModuleDisabledPage({ slug }: { slug: string }) {
  const { getModule } = useSystemModules();
  const mod = getModule(slug);

  return (
    <div className="flex flex-col items-center justify-center gap-4 py-20 md:py-32 text-center px-4">
      <div className="flex h-14 w-14 md:h-16 md:w-16 items-center justify-center rounded-2xl bg-muted border border-border">
        <span className="text-2xl">{mod?.icon || "🚫"}</span>
      </div>
      <h2 className="font-display text-xl md:text-2xl text-foreground">
        {mod?.name || slug} jest wyłączony
      </h2>
      <p className="text-sm md:text-base text-muted-foreground max-w-xs">
        {mod?.description || "Ten moduł jest tymczasowo niedostępny."}
      </p>
    </div>
  );
}
