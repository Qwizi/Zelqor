import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  buyFromListing,
  cancelListing,
  createListing,
  getMarketConfig,
  getMarketListings,
  getMyListings,
  getMyTradeHistory,
  type MarketConfigOut,
  type MarketListingOut,
  type MarketTransactionOut,
  type PaginatedResponse,
} from "@/lib/api";
import { requireToken } from "@/lib/queryClient";
import { queryKeys } from "@/lib/queryKeys";

export function useMarketConfig() {
  return useQuery<MarketConfigOut>({
    queryKey: queryKeys.marketplace.config(),
    queryFn: () => getMarketConfig(),
    staleTime: 5 * 60 * 1000,
  });
}

export function useMarketListings(itemSlug?: string, listingType?: string, limit?: number, offset?: number) {
  return useQuery<PaginatedResponse<MarketListingOut>>({
    queryKey: queryKeys.marketplace.listings({
      itemSlug,
      listingType,
      limit,
      offset,
    }),
    queryFn: () => getMarketListings(itemSlug, listingType, limit, offset),
    staleTime: 30_000,
  });
}

export function useMyListings(limit?: number, offset?: number) {
  return useQuery<PaginatedResponse<MarketListingOut>>({
    queryKey: queryKeys.marketplace.myListings(limit, offset),
    queryFn: () => getMyListings(requireToken(), limit, offset),
    staleTime: 30_000,
  });
}

export function useMyTradeHistory(limit?: number, offset?: number) {
  return useQuery<PaginatedResponse<MarketTransactionOut>>({
    queryKey: queryKeys.marketplace.history(limit, offset),
    queryFn: () => getMyTradeHistory(requireToken(), limit, offset),
    staleTime: 30_000,
  });
}

export function useCreateListing() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { item_slug: string; listing_type: string; quantity: number; price_per_unit: number }) =>
      createListing(requireToken(), data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.marketplace.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.inventory.all });
    },
  });
}

export function useBuyFromListing() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ listingId, quantity }: { listingId: string; quantity: number }) =>
      buyFromListing(requireToken(), listingId, quantity),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.marketplace.all });
      queryClient.invalidateQueries({
        queryKey: queryKeys.inventory.wallet(),
      });
      queryClient.invalidateQueries({ queryKey: queryKeys.inventory.my() });
    },
  });
}

export function useCancelListing() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (listingId: string) => cancelListing(requireToken(), listingId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.marketplace.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.inventory.all });
    },
  });
}
