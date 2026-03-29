import type { QueryClient, QueryKey } from "@tanstack/react-query";

const CHANNEL_NAME = "zelqor:query-sync";

/**
 * Cross-tab query cache synchronization via BroadcastChannel.
 *
 * When a mutation invalidates queries in one tab, all other tabs
 * automatically invalidate the same query keys so data stays fresh
 * without manual refresh.
 */
export function setupQueryBroadcast(queryClient: QueryClient) {
  if (typeof window === "undefined" || !("BroadcastChannel" in window)) return;

  const channel = new BroadcastChannel(CHANNEL_NAME);
  let isFromBroadcast = false;

  // Listen for invalidations from other tabs
  channel.onmessage = (event: MessageEvent) => {
    const { type, queryKey } = event.data as {
      type: string;
      queryKey: QueryKey;
    };
    if (type === "invalidate" && queryKey) {
      // Flag to prevent re-broadcasting received invalidations
      isFromBroadcast = true;
      queryClient.invalidateQueries({ queryKey, refetchType: "active" });
      isFromBroadcast = false;
    }
  };

  // Patch invalidateQueries to also broadcast to other tabs
  const originalInvalidate = queryClient.invalidateQueries.bind(queryClient);
  queryClient.invalidateQueries = ((...args: Parameters<typeof originalInvalidate>) => {
    const result = originalInvalidate(...args);
    // Only broadcast if this invalidation originated locally (not from another tab)
    if (!isFromBroadcast) {
      const filters = args[0];
      if (filters?.queryKey) {
        try {
          channel.postMessage({ type: "invalidate", queryKey: filters.queryKey });
        } catch {
          // BroadcastChannel may be closed
        }
      }
    }
    return result;
  }) as typeof queryClient.invalidateQueries;

  window.addEventListener("beforeunload", () => {
    channel.close();
  });
}
