"use client";

import { type ReactNode, useMemo } from "react";
import {
  SystemModulesContext,
  buildSystemModulesValue,
} from "@/hooks/useSystemModules";
import { useConfig } from "@/hooks/queries";

/**
 * Global provider for system module states.
 * Fetches module config via TanStack Query and provides it to all children.
 * Placed in root layout so both (auth) and (main) pages have access.
 */
export function SystemModulesProvider({ children }: { children: ReactNode }) {
  const { data: config } = useConfig();

  const contextValue = useMemo(
    () => buildSystemModulesValue(config?.system_modules ?? []),
    [config?.system_modules]
  );

  return (
    <SystemModulesContext.Provider value={contextValue}>
      {children}
    </SystemModulesContext.Provider>
  );
}
