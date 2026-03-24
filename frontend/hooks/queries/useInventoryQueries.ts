import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getItemCategories,
  getMyDrops,
  getMyInventory,
  getMyWallet,
  type InventoryItemOut,
  type ItemCategoryOut,
  type ItemDropOut,
  openCrate,
  type PaginatedResponse,
  type WalletOut,
} from "@/lib/api";
import { requireToken } from "@/lib/queryClient";
import { queryKeys } from "@/lib/queryKeys";

export function useItemCategories() {
  return useQuery<ItemCategoryOut[]>({
    queryKey: queryKeys.inventory.categories(),
    queryFn: () => getItemCategories(),
    staleTime: 5 * 60 * 1000,
  });
}

export function useMyInventory(limit?: number, offset?: number) {
  return useQuery<PaginatedResponse<InventoryItemOut>>({
    queryKey: queryKeys.inventory.my(limit, offset),
    queryFn: () => getMyInventory(requireToken(), limit, offset),
    staleTime: 30_000,
  });
}

export function useMyWallet() {
  return useQuery<WalletOut>({
    queryKey: queryKeys.inventory.wallet(),
    queryFn: () => getMyWallet(requireToken()),
    staleTime: 30_000,
  });
}

export function useMyDrops(limit?: number, offset?: number) {
  return useQuery<PaginatedResponse<ItemDropOut>>({
    queryKey: queryKeys.inventory.drops(limit, offset),
    queryFn: () => getMyDrops(requireToken(), limit, offset),
    staleTime: 30_000,
  });
}

export function useOpenCrate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ crateSlug, keySlug }: { crateSlug: string; keySlug: string }) =>
      openCrate(requireToken(), crateSlug, keySlug),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.inventory.all });
    },
  });
}
