import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  type APIKeyCreated,
  type APIKeyOut,
  type AvailableEvents,
  type AvailableScopes,
  createAPIKey,
  createDeveloperApp,
  createWebhook,
  type DeveloperApp,
  type DeveloperAppCreated,
  deleteAPIKey,
  deleteDeveloperApp,
  deleteWebhook,
  getAPIKeys,
  getAppUsage,
  getAvailableEvents,
  getAvailableScopes,
  getDeveloperApp,
  getDeveloperApps,
  getWebhookDeliveries,
  getWebhooks,
  type PaginatedResponse,
  testWebhook,
  type UsageStats,
  updateDeveloperApp,
  updateWebhook,
  type WebhookDelivery,
  type WebhookOut,
} from "@/lib/api";
import { requireToken } from "@/lib/queryClient";
import { queryKeys } from "@/lib/queryKeys";

// --- Apps ---

export function useDeveloperApps(limit?: number, offset?: number) {
  return useQuery<PaginatedResponse<DeveloperApp>>({
    queryKey: queryKeys.developers.apps(limit, offset),
    queryFn: () => getDeveloperApps(requireToken()),
    staleTime: 60 * 1000,
  });
}

export function useDeveloperApp(appId: string) {
  return useQuery<DeveloperApp>({
    queryKey: queryKeys.developers.app(appId),
    queryFn: () => getDeveloperApp(requireToken(), appId),
    enabled: !!appId,
    staleTime: 60 * 1000,
  });
}

export function useCreateDeveloperApp() {
  const queryClient = useQueryClient();
  return useMutation<DeveloperAppCreated, Error, { name: string; description?: string }>({
    mutationFn: (data) => createDeveloperApp(requireToken(), data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.developers.all });
    },
  });
}

export function useUpdateDeveloperApp() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ appId, data }: { appId: string; data: { name?: string; description?: string } }) =>
      updateDeveloperApp(requireToken(), appId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.developers.all });
    },
  });
}

export function useDeleteDeveloperApp() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (appId: string) => deleteDeveloperApp(requireToken(), appId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.developers.all });
    },
  });
}

// --- API Keys ---

export function useAPIKeys(appId: string, limit?: number, offset?: number) {
  return useQuery<PaginatedResponse<APIKeyOut>>({
    queryKey: queryKeys.developers.keys(appId),
    queryFn: () => getAPIKeys(requireToken(), appId, limit, offset),
    enabled: !!appId,
    staleTime: 60 * 1000,
  });
}

export function useCreateAPIKey() {
  const queryClient = useQueryClient();
  return useMutation<APIKeyCreated, Error, { appId: string; data: { scopes: string[]; rate_limit?: number } }>({
    mutationFn: ({ appId, data }) => createAPIKey(requireToken(), appId, data),
    onSuccess: (_, { appId }) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.developers.keys(appId),
      });
    },
  });
}

export function useDeleteAPIKey() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ appId, keyId }: { appId: string; keyId: string }) => deleteAPIKey(requireToken(), appId, keyId),
    onSuccess: (_, { appId }) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.developers.keys(appId),
      });
    },
  });
}

// --- Webhooks ---

export function useWebhooks(appId: string, limit?: number, offset?: number) {
  return useQuery<PaginatedResponse<WebhookOut>>({
    queryKey: queryKeys.developers.webhooks(appId),
    queryFn: () => getWebhooks(requireToken(), appId, limit, offset),
    enabled: !!appId,
    staleTime: 60 * 1000,
  });
}

export function useCreateWebhook() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ appId, data }: { appId: string; data: { url: string; events: string[] } }) =>
      createWebhook(requireToken(), appId, data),
    onSuccess: (_, { appId }) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.developers.webhooks(appId),
      });
    },
  });
}

export function useUpdateWebhook() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      appId,
      webhookId,
      data,
    }: {
      appId: string;
      webhookId: string;
      data: { url?: string; events?: string[]; is_active?: boolean };
    }) => updateWebhook(requireToken(), appId, webhookId, data),
    onSuccess: (_, { appId }) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.developers.webhooks(appId),
      });
    },
  });
}

export function useDeleteWebhook() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ appId, webhookId }: { appId: string; webhookId: string }) =>
      deleteWebhook(requireToken(), appId, webhookId),
    onSuccess: (_, { appId }) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.developers.webhooks(appId),
      });
    },
  });
}

export function useTestWebhook() {
  return useMutation({
    mutationFn: ({ appId, webhookId }: { appId: string; webhookId: string }) =>
      testWebhook(requireToken(), appId, webhookId),
  });
}

export function useWebhookDeliveries(appId: string, webhookId: string, limit?: number, offset?: number) {
  return useQuery<PaginatedResponse<WebhookDelivery>>({
    queryKey: queryKeys.developers.deliveries(appId, webhookId),
    queryFn: () => getWebhookDeliveries(requireToken(), appId, webhookId, limit, offset),
    enabled: !!appId && !!webhookId,
    staleTime: 30_000,
  });
}

// --- Usage & Meta ---

export function useAppUsage(appId: string) {
  return useQuery<UsageStats>({
    queryKey: queryKeys.developers.usage(appId),
    queryFn: () => getAppUsage(requireToken(), appId),
    enabled: !!appId,
    staleTime: 60 * 1000,
  });
}

export function useAvailableScopes() {
  return useQuery<AvailableScopes>({
    queryKey: queryKeys.developers.scopes(),
    queryFn: () => getAvailableScopes(requireToken()),
    staleTime: 5 * 60 * 1000,
  });
}

export function useAvailableEvents() {
  return useQuery<AvailableEvents>({
    queryKey: queryKeys.developers.events(),
    queryFn: () => getAvailableEvents(requireToken()),
    staleTime: 5 * 60 * 1000,
  });
}
