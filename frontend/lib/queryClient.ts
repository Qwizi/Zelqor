import { QueryClient } from "@tanstack/react-query";
import { getAccessToken } from "@/lib/auth";
import { APIError } from "@/lib/api";

/**
 * Get token from localStorage or throw — prevents unauthenticated queries from firing.
 */
export function requireToken(): string {
  const token = getAccessToken();
  if (!token) throw new Error("Not authenticated");
  return token;
}

export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 5 * 60 * 1000,
        retry: (failureCount, error) => {
          if (
            error instanceof APIError &&
            (error.status === 401 || error.status === 403)
          ) {
            return false;
          }
          return failureCount < 2;
        },
        refetchOnWindowFocus: true,
      },
    },
  });
}
