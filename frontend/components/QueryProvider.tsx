"use client";

import { useEffect, useState } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { createQueryClient } from "@/lib/queryClient";
import { setupQueryBroadcast } from "@/lib/queryBroadcast";

export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => createQueryClient());

  useEffect(() => {
    setupQueryBroadcast(queryClient);
  }, [queryClient]);

  return (
    <QueryClientProvider client={queryClient}>
      {children}
      <ReactQueryDevtools initialIsOpen={false} />
    </QueryClientProvider>
  );
}
