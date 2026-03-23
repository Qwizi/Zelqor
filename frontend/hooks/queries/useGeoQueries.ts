import { useQuery } from "@tanstack/react-query";
import {
  getRegions,
  getRegionsGraph,
  type GeoJSON,
  type RegionGraphEntry,
} from "@/lib/api";
import { queryKeys } from "@/lib/queryKeys";

export function useRegions() {
  return useQuery<GeoJSON>({
    queryKey: queryKeys.geo.regions(),
    queryFn: () => getRegions(),
    staleTime: Infinity,
    gcTime: 30 * 60 * 1000,
  });
}

export function useRegionsGraph(matchId?: string) {
  return useQuery<RegionGraphEntry[]>({
    queryKey: queryKeys.geo.regionsGraph(matchId),
    queryFn: () => getRegionsGraph(matchId),
    staleTime: Infinity,
    gcTime: 30 * 60 * 1000,
  });
}
