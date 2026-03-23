import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getMyDecks,
  getDeck,
  createDeck,
  updateDeck,
  deleteDeck,
  setDefaultDeck,
  type DeckOut,
  type PaginatedResponse,
} from "@/lib/api";
import { queryKeys } from "@/lib/queryKeys";
import { requireToken } from "@/lib/queryClient";

export function useMyDecks(limit?: number, offset?: number) {
  return useQuery<PaginatedResponse<DeckOut>>({
    queryKey: queryKeys.decks.list(limit, offset),
    queryFn: () => getMyDecks(requireToken(), limit, offset),
    staleTime: 30_000,
  });
}

export function useDeck(deckId: string) {
  return useQuery<DeckOut>({
    queryKey: queryKeys.decks.detail(deckId),
    queryFn: () => getDeck(requireToken(), deckId),
    enabled: !!deckId,
    staleTime: 30_000,
  });
}

export function useCreateDeck() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { name: string }) =>
      createDeck(requireToken(), data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.decks.all });
    },
  });
}

export function useUpdateDeck() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      deckId,
      data,
    }: {
      deckId: string;
      data: { name?: string; items?: { item_slug: string; quantity: number }[] };
    }) => updateDeck(requireToken(), deckId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.decks.all });
    },
  });
}

export function useDeleteDeck() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (deckId: string) => deleteDeck(requireToken(), deckId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.decks.all });
    },
  });
}

export function useSetDefaultDeck() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (deckId: string) => setDefaultDeck(requireToken(), deckId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.decks.all });
    },
  });
}
