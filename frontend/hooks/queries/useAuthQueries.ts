import { useQuery } from "@tanstack/react-query";
import {
  getMe,
  getOnlineStats,
  getLeaderboard,
  getLinkedSocialAccounts,
  type User,
  type OnlineStats,
  type LeaderboardEntry,
  type PaginatedResponse,
  type SocialAccountOut,
} from "@/lib/api";
import { queryKeys } from "@/lib/queryKeys";
import { requireToken } from "@/lib/queryClient";

export function useMe() {
  return useQuery<User>({
    queryKey: queryKeys.auth.me(),
    queryFn: () => getMe(requireToken()),
    staleTime: 60 * 1000,
  });
}

export function useOnlineStats(options?: { refetchInterval?: number }) {
  return useQuery<OnlineStats>({
    queryKey: queryKeys.auth.onlineStats(),
    queryFn: () => getOnlineStats(),
    staleTime: 10_000,
    refetchInterval: options?.refetchInterval,
  });
}

export function useLeaderboard(limit?: number, offset?: number) {
  return useQuery<PaginatedResponse<LeaderboardEntry>>({
    queryKey: queryKeys.auth.leaderboard(limit, offset),
    queryFn: () => getLeaderboard(requireToken(), limit, offset),
    staleTime: 60 * 1000,
  });
}

export function useLinkedSocialAccounts() {
  return useQuery<SocialAccountOut[]>({
    queryKey: [...queryKeys.auth.all, "social-accounts"],
    queryFn: () => getLinkedSocialAccounts(requireToken()),
    staleTime: 60 * 1000,
  });
}
