import { QueryClient } from "@tanstack/react-query";
import { APIError } from "@/lib/api";
import { isAuthenticated } from "@/lib/auth";

/**
 * Guard that throws if the user is not authenticated.
 * Since tokens are now httpOnly cookies (not readable by JS), this checks the
 * local `isAuthenticated` flag instead of reading a token from localStorage.
 *
 * The returned string is an empty sentinel — callers that previously passed
 * the token to API functions no longer need to: cookies are sent automatically.
 */
export function requireToken(): string {
  if (!isAuthenticated()) throw new Error("Not authenticated");
  return "";
}

export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 5 * 60 * 1000,
        retry: (failureCount, error) => {
          if (error instanceof APIError && (error.status === 401 || error.status === 403)) {
            return false;
          }
          return failureCount < 2;
        },
        refetchOnWindowFocus: true,
      },
    },
  });
}
