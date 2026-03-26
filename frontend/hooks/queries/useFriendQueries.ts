import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  acceptFriendRequest,
  acceptGameInvite,
  type FriendshipOut,
  getFriends,
  getReceivedRequests,
  getSentRequests,
  inviteFriendToGame,
  type PaginatedResponse,
  rejectFriendRequest,
  rejectGameInvite,
  removeFriend,
  sendFriendRequest,
} from "@/lib/api";
import { requireToken } from "@/lib/queryClient";
import { queryKeys } from "@/lib/queryKeys";

export function useFriends(limit?: number, offset?: number, options?: { refetchInterval?: number }) {
  return useQuery<PaginatedResponse<FriendshipOut>>({
    queryKey: queryKeys.friends.list(limit, offset),
    queryFn: () => getFriends(requireToken(), limit, offset),
    staleTime: 30_000,
    refetchInterval: options?.refetchInterval,
  });
}

export function useReceivedRequests(limit?: number, offset?: number, options?: { refetchInterval?: number }) {
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
    mutationFn: (username: string) => sendFriendRequest(requireToken(), username),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.friends.all });
    },
  });
}

export function useAcceptFriendRequest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (friendshipId: string) => acceptFriendRequest(requireToken(), friendshipId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.friends.all });
    },
  });
}

export function useRejectFriendRequest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (friendshipId: string) => rejectFriendRequest(requireToken(), friendshipId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.friends.all });
    },
  });
}

export function useRemoveFriend() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (friendshipId: string) => removeFriend(requireToken(), friendshipId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.friends.all });
    },
  });
}

export function useInviteFriendToGame() {
  return useMutation({
    mutationFn: ({ friendshipId, gameMode }: { friendshipId: string; gameMode: string }) =>
      inviteFriendToGame(friendshipId, gameMode),
  });
}

export function useAcceptGameInvite() {
  return useMutation({
    mutationFn: (notificationId: string) => acceptGameInvite(requireToken(), notificationId),
  });
}

export function useRejectGameInvite() {
  return useMutation({
    mutationFn: (notificationId: string) => rejectGameInvite(requireToken(), notificationId),
  });
}
