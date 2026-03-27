import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  type BuyShopItemResponse,
  buyShopItem,
  type CreateCheckoutResponse,
  createCheckout,
  type GemPackageOut,
  type GemWalletOut,
  getGemPackages,
  getGemWallet,
  getShopItems,
  type ShopItemOut,
} from "@/lib/api";
import { queryKeys } from "@/lib/queryKeys";

export function useGemWallet() {
  return useQuery<GemWalletOut>({
    queryKey: queryKeys.shop.gemWallet(),
    queryFn: () => getGemWallet(),
    staleTime: 10_000,
  });
}

export function useGemPackages() {
  return useQuery<GemPackageOut[]>({
    queryKey: queryKeys.shop.gemPackages(),
    queryFn: () => getGemPackages(),
    staleTime: 300_000,
  });
}

export function useShopItems(category?: string) {
  return useQuery<ShopItemOut[]>({
    queryKey: queryKeys.shop.items(category),
    queryFn: () => getShopItems(category),
    staleTime: 60_000,
  });
}

export function useBuyShopItem() {
  const queryClient = useQueryClient();
  return useMutation<BuyShopItemResponse, Error, string>({
    mutationFn: (shopItemId: string) => buyShopItem(shopItemId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.shop.gemWallet() });
      queryClient.invalidateQueries({ queryKey: queryKeys.shop.all });
    },
  });
}

export function useCreateCheckout() {
  return useMutation<CreateCheckoutResponse, Error, { packageSlug: string; idempotencyKey: string }>({
    mutationFn: ({ packageSlug, idempotencyKey }) => createCheckout(packageSlug, idempotencyKey),
    onSuccess: (data) => {
      window.location.href = data.session_url;
    },
  });
}
