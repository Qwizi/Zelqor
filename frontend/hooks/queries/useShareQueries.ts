import { useQuery } from "@tanstack/react-query";
import { getSharedResource, getSharedSnapshot, type SharedMatchData, type SnapshotDetail } from "@/lib/api";
import { queryKeys } from "@/lib/queryKeys";

export function useSharedResource(shareToken: string) {
  return useQuery<SharedMatchData>({
    queryKey: queryKeys.share.resource(shareToken),
    queryFn: () => getSharedResource(shareToken),
    enabled: !!shareToken,
    staleTime: Infinity,
  });
}

export function useSharedSnapshot(shareToken: string, tick: number) {
  return useQuery<SnapshotDetail>({
    queryKey: [...queryKeys.share.snapshot(shareToken), tick],
    queryFn: () => getSharedSnapshot(shareToken, tick),
    enabled: !!shareToken && tick >= 0,
    staleTime: Infinity,
  });
}
