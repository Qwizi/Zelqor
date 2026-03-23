import { useQuery } from "@tanstack/react-query";
import {
  getMyMatches,
  getPlayerMatches,
  getMatch,
  getMatchResult,
  getMatchSnapshots,
  getSnapshot,
  getMatchmakingStatus,
  type Match,
  type MatchResult,
  type MatchmakingStatus,
  type SnapshotTick,
  type SnapshotDetail,
  type PaginatedResponse,
} from "@/lib/api";
import { queryKeys } from "@/lib/queryKeys";
import { requireToken } from "@/lib/queryClient";

export function useMyMatches(
  limit?: number,
  offset?: number,
  options?: { refetchInterval?: number }
) {
  return useQuery<PaginatedResponse<Match>>({
    queryKey: queryKeys.matches.my(limit, offset),
    queryFn: () => getMyMatches(requireToken(), limit, offset),
    staleTime: 30_000,
    refetchInterval: options?.refetchInterval,
  });
}

export function usePlayerMatches(
  userId: string,
  limit?: number,
  offset?: number
) {
  return useQuery<PaginatedResponse<Match>>({
    queryKey: queryKeys.matches.player(userId, limit, offset),
    queryFn: () => getPlayerMatches(requireToken(), userId, limit, offset),
    enabled: !!userId,
    staleTime: 30_000,
  });
}

export function useMatch(matchId: string) {
  return useQuery<Match>({
    queryKey: queryKeys.matches.detail(matchId),
    queryFn: () => getMatch(requireToken(), matchId),
    enabled: !!matchId,
    staleTime: 30_000,
  });
}

export function useMatchResult(matchId: string) {
  return useQuery<MatchResult>({
    queryKey: queryKeys.matches.result(matchId),
    queryFn: () => getMatchResult(requireToken(), matchId),
    enabled: !!matchId,
    staleTime: 60 * 1000,
  });
}

export function useMatchSnapshots(matchId: string) {
  return useQuery<SnapshotTick[]>({
    queryKey: queryKeys.matches.snapshots(matchId),
    queryFn: () => getMatchSnapshots(requireToken(), matchId),
    enabled: !!matchId,
    staleTime: Infinity,
  });
}

export function useSnapshot(matchId: string, tick: number) {
  return useQuery<SnapshotDetail>({
    queryKey: [...queryKeys.matches.snapshots(matchId), tick],
    queryFn: () => getSnapshot(requireToken(), matchId, tick),
    enabled: !!matchId && tick >= 0,
    staleTime: Infinity,
  });
}

export function useMatchmakingStatus(options?: { enabled?: boolean }) {
  return useQuery<MatchmakingStatus>({
    queryKey: queryKeys.matchmaking.status(),
    queryFn: () => getMatchmakingStatus(requireToken()),
    staleTime: 5_000,
    refetchInterval: 10_000,
    enabled: options?.enabled,
  });
}
