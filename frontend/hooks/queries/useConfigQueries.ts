import { useQuery } from "@tanstack/react-query";
import {
  getConfig,
  getGameModes,
  getGameMode,
  type FullConfig,
  type GameModeListItem,
  type GameMode,
} from "@/lib/api";
import { queryKeys } from "@/lib/queryKeys";

export function useConfig() {
  return useQuery<FullConfig>({
    queryKey: queryKeys.config.full(),
    queryFn: () => getConfig(),
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });
}

export function useGameModes() {
  return useQuery<GameModeListItem[]>({
    queryKey: queryKeys.config.gameModes(),
    queryFn: () => getGameModes(),
    staleTime: 5 * 60 * 1000,
  });
}

export function useGameMode(slug: string) {
  return useQuery<GameMode>({
    queryKey: queryKeys.config.gameMode(slug),
    queryFn: () => getGameMode(slug),
    enabled: !!slug,
    staleTime: 5 * 60 * 1000,
  });
}
