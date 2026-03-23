import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getFriends,
  getReceivedRequests,
  getSentRequests,
  sendFriendRequest,
  acceptFriendRequest,
  rejectFriendRequest,
  removeFriend,
  inviteFriendToGame,
  acceptGameInvite,
  rejectGameInvite,
  type FriendshipOut,
  type PaginatedResponse,
} from "@/lib/api";
import { queryKeys } from "@/lib/queryKeys";
import { requireToken } from "@/lib/queryClient";

export function useFriends(
  limit?: number,
  offset?: number,
  options?: { refetchInterval?: number }
) {
  return useQuery<PaginatedResponse<FriendshipOut>>({
    queryKey: queryKeys.friends.list(limit, offset),
    queryFn: () => getFriends(requireToken(), limit, offset),
    staleTime: 30_000,
    refetchInterval: options?.refetchInterval,
  });
}

export function useReceivedRequests(
  limit?: number,
  offset?: number,
  options?: { refetchInterval?: number }
) {
  return useQuery<PaginatedResponse<FriendshipOut>>({
    queryKey: queryKeys.friends.received(limit, offset),
    queryFn: () => getReceivedRequests(requireToken(), limit, offset),
    staleTime: 30_000,
    refetchInterval: options?.refetchInterval,
  });
}

export function useSentRequests(limit?: number, offset?: number) {
  return useQuery<PaginatedResponse<FriendshipOut>>({
    queryKey: queryKeys.friends.sent(limit, offset),
    queryFn: () => getSentRequests(requireToken(), limit, offset),
    staleTime: 30_000,
  });
}

export function useSendFriendRequest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (username: string) =>
      sendFriendRequest(requireToken(), username),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.friends.all });
    },
  });
}

export function useAcceptFriendRequest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (friendshipId: string) =>
      acceptFriendRequest(requireToken(), friendshipId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.friends.all });
    },
  });
}

export function useRejectFriendRequest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (friendshipId: string) =>
      rejectFriendRequest(requireToken(), friendshipId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.friends.all });
    },
  });
}

export function useRemoveFriend() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (friendshipId: string) =>
      removeFriend(requireToken(), friendshipId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.friends.all });
    },
  });
}

export function useInviteFriendToGame() {
  return useMutation({
    mutationFn: ({
      friendshipId,
      gameMode,
    }: {
      friendshipId: string;
      gameMode: string;
    }) => inviteFriendToGame(requireToken(), friendshipId, gameMode),
  });
}

export function useAcceptGameInvite() {
  return useMutation({
    mutationFn: (notificationId: string) =>
      acceptGameInvite(requireToken(), notificationId),
  });
}

export function useRejectGameInvite() {
  return useMutation({
    mutationFn: (notificationId: string) =>
      rejectGameInvite(requireToken(), notificationId),
  });
}
