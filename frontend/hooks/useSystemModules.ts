"use client";

import { createContext, useContext, useMemo } from "react";
import type { SystemModule } from "@/lib/api";

interface SystemModulesContextValue {
  modules: SystemModule[];
  /** Check if a module is enabled. Unknown modules default to true (fail-open). */
  isEnabled: (slug: string) => boolean;
  /** Get full config object for a module. */
  getConfig: (slug: string) => Record<string, unknown>;
  /** Get a specific config value with typed default. */
  getConfigValue: <T>(slug: string, key: string, fallback: T) => T;
  /** Get the full module object by slug (or undefined). */
  getModule: (slug: string) => SystemModule | undefined;
}

export const SystemModulesContext = createContext<SystemModulesContextValue>({
  modules: [],
  isEnabled: () => true,
  getConfig: () => ({}),
  getConfigValue: <T>(_slug: string, _key: string, fallback: T) => fallback,
  getModule: () => undefined,
});

/**
 * Hook to check system module states.
 *
 * Usage:
 *   const { isEnabled, getConfigValue } = useSystemModules();
 *
 *   if (!isEnabled('shop')) return null;
 *
 *   const maxListings = getConfigValue('marketplace', 'max_listings', 50);
 */
export function useSystemModules(): SystemModulesContextValue {
  return useContext(SystemModulesContext);
}

/**
 * Hook for a single module's config. Returns typed values.
 *
 * Usage:
 *   const { enabled, config, getValue } = useModuleConfig('anticheat');
 *   if (!enabled) return null;
 *   const autoBan = getValue('auto_ban_enabled', false);
 */
export function useModuleConfig(slug: string) {
  const { isEnabled, getConfig, getConfigValue, getModule } = useSystemModules();

  return useMemo(
    () => ({
      enabled: isEnabled(slug),
      config: getConfig(slug),
      module: getModule(slug),
      getValue: <T>(key: string, fallback: T): T => getConfigValue(slug, key, fallback),
    }),
    [slug, isEnabled, getConfig, getConfigValue, getModule],
  );
}

/**
 * Build the context value from a list of SystemModule objects.
 * Used in the provider component.
 */
export function buildSystemModulesValue(modules: SystemModule[]): SystemModulesContextValue {
  const bySlug = new Map(modules.map((m) => [m.slug, m]));

  return {
    modules,
    isEnabled: (slug: string) => {
      const mod = bySlug.get(slug);
      return mod ? mod.enabled : true;
    },
    getConfig: (slug: string) => {
      const mod = bySlug.get(slug);
      return mod?.config ?? {};
    },
    getConfigValue: <T>(slug: string, key: string, fallback: T): T => {
      const mod = bySlug.get(slug);
      const val = mod?.config?.[key];
      return val !== undefined ? (val as T) : fallback;
    },
    getModule: (slug: string) => bySlug.get(slug),
  };
}
