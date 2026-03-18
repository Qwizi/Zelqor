"use client";

import { createContext, useContext } from "react";
import type { SystemModule } from "@/lib/api";

interface SystemModulesContextValue {
  modules: SystemModule[];
  isEnabled: (slug: string) => boolean;
  getConfig: (slug: string) => Record<string, unknown>;
}

export const SystemModulesContext = createContext<SystemModulesContextValue>({
  modules: [],
  isEnabled: () => true,
  getConfig: () => ({}),
});

/**
 * Hook to check system module states.
 *
 * Usage:
 *   const { isEnabled } = useSystemModules();
 *   if (!isEnabled('shop')) return null;
 */
export function useSystemModules(): SystemModulesContextValue {
  return useContext(SystemModulesContext);
}

/**
 * Build the context value from a list of SystemModule objects.
 * Used in the provider component.
 */
export function buildSystemModulesValue(
  modules: SystemModule[]
): SystemModulesContextValue {
  const bySlug = new Map(modules.map((m) => [m.slug, m]));

  return {
    modules,
    isEnabled: (slug: string) => {
      const mod = bySlug.get(slug);
      // Unknown modules are enabled by default (fail-open)
      return mod ? mod.enabled : true;
    },
    getConfig: (slug: string) => {
      const mod = bySlug.get(slug);
      return mod?.config ?? {};
    },
  };
}
