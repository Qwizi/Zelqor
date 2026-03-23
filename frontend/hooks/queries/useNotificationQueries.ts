import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getNotifications,
  getUnreadNotificationCount,
  markNotificationRead,
  markAllNotificationsRead,
  type NotificationOut,
  type PaginatedResponse,
} from "@/lib/api";
import { queryKeys } from "@/lib/queryKeys";
import { requireToken } from "@/lib/queryClient";

export function useNotifications(limit?: number, offset?: number) {
  return useQuery<PaginatedResponse<NotificationOut>>({
    queryKey: queryKeys.notifications.list(limit, offset),
    queryFn: () => getNotifications(requireToken(), limit, offset),
    staleTime: 15_000,
  });
}

export function useUnreadNotificationCount() {
  return useQuery<{ count: number }>({
    queryKey: queryKeys.notifications.unreadCount(),
    queryFn: () => getUnreadNotificationCount(requireToken()),
    staleTime: 10_000,
  });
}

export function useMarkNotificationRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => markNotificationRead(requireToken(), id),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.notifications.all,
      });
    },
  });
}

export function useMarkAllNotificationsRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => markAllNotificationsRead(requireToken()),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.notifications.all,
      });
    },
  });
}
