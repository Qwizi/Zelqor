import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getRecipes,
  craftItem,
  type RecipeOut,
} from "@/lib/api";
import { queryKeys } from "@/lib/queryKeys";
import { requireToken } from "@/lib/queryClient";

export function useRecipes() {
  return useQuery<RecipeOut[]>({
    queryKey: queryKeys.crafting.recipes(),
    queryFn: () => getRecipes(),
    staleTime: 5 * 60 * 1000,
  });
}

export function useCraftItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (recipeSlug: string) => craftItem(requireToken(), recipeSlug),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.inventory.all });
    },
  });
}
