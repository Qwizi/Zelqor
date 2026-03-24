import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  type ConversationOut,
  type DirectMessageOut,
  getConversations,
  getMessages,
  getUnreadMessageCount,
  type PaginatedResponse,
  sendMessage,
} from "@/lib/api";
import { requireToken } from "@/lib/queryClient";
import { queryKeys } from "@/lib/queryKeys";

export function useConversations() {
  return useQuery<ConversationOut[]>({
    queryKey: queryKeys.messages.conversations(),
    queryFn: () => getConversations(requireToken()),
    staleTime: 15_000,
  });
}

export function useMessages(userId: string, limit?: number, offset?: number) {
  return useQuery<PaginatedResponse<DirectMessageOut>>({
    queryKey: queryKeys.messages.thread(userId, limit, offset),
    queryFn: () => getMessages(requireToken(), userId, limit, offset),
    enabled: !!userId,
    staleTime: 15_000,
  });
}

export function useUnreadMessageCount() {
  return useQuery<{ count: number }>({
    queryKey: queryKeys.messages.unreadCount(),
    queryFn: () => getUnreadMessageCount(requireToken()),
    staleTime: 10_000,
  });
}

export function useSendMessage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, content }: { userId: string; content: string }) =>
      sendMessage(requireToken(), userId, content),
    onSuccess: (_, { userId }) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.messages.thread(userId),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.messages.conversations(),
      });
    },
  });
}
