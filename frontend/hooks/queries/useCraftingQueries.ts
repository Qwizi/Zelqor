import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { craftItem, getRecipes, type RecipeOut } from "@/lib/api";
import { requireToken } from "@/lib/queryClient";
import { queryKeys } from "@/lib/queryKeys";

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
