import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  type EquipCosmeticPayload,
  type EquippedCosmeticOut,
  equipCosmetic,
  getEquippedCosmetics,
  unequipCosmetic,
} from "@/lib/api";
import { requireToken } from "@/lib/queryClient";
import { queryKeys } from "@/lib/queryKeys";

export function useEquippedCosmetics() {
  return useQuery<EquippedCosmeticOut[]>({
    queryKey: queryKeys.cosmetics.equipped(),
    queryFn: () => getEquippedCosmetics(requireToken()),
    staleTime: 30_000,
  });
}

export function useEquipCosmetic() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: EquipCosmeticPayload) => equipCosmetic(requireToken(), payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.cosmetics.all });
    },
  });
}

export function useUnequipCosmetic() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (slot: string) => unequipCosmetic(requireToken(), slot),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.cosmetics.all });
    },
  });
}
