"use client";

import { type ReactNode, useEffect, useState } from "react";
import { getConfig } from "@/lib/api";
import {
  SystemModulesContext,
  buildSystemModulesValue,
} from "@/hooks/useSystemModules";

/**
 * Global provider for system module states.
 * Fetches module config on mount and provides it to all children.
 * Placed in root layout so both (auth) and (main) pages have access.
 */
export function SystemModulesProvider({ children }: { children: ReactNode }) {
  const [contextValue, setContextValue] = useState(() =>
    buildSystemModulesValue([])
  );

  useEffect(() => {
    getConfig()
      .then((cfg) => {
        if (cfg.system_modules) {
          setContextValue(buildSystemModulesValue(cfg.system_modules));
        }
      })
      .catch(() => {});
  }, []);

  return (
    <SystemModulesContext.Provider value={contextValue}>
      {children}
    </SystemModulesContext.Provider>
  );
}
