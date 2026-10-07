import { useQuery } from '@tanstack/react-query';
import { fplService } from '../services/fplApi';
import { FPLBootstrapStaticResponse, FPLLiveGameweekResponse } from '../types/fpl';

export const FPL_QUERY_KEYS = {
  bootstrap: ['fpl', 'bootstrap-static'] as const,
  liveGameweek: (gwId: number) => ['fpl', 'live-gameweek', gwId] as const,
};

/**
 * Hook for core metadata.
 * Stale time set to 30 minutes; cache time 6 hours.
 */
export function useFPLBootstrap() {
  return useQuery<FPLBootstrapStaticResponse, Error>({
    queryKey: FPL_QUERY_KEYS.bootstrap,
    queryFn: () => fplService.getBootstrapStatic(),
    staleTime: 1000 * 60 * 30, // 30 minutes
    gcTime: 1000 * 60 * 60 * 6, // 6 hours
  });
}

/**
 * Hook for live match stats.
 * Automatically polls every 60 seconds when fixtures are actively in progress.
 */
export function useFPLLiveGameweek(gameweekId: number, isLive: boolean = false) {
  return useQuery<FPLLiveGameweekResponse, Error>({
    queryKey: FPL_QUERY_KEYS.liveGameweek(gameweekId),
    queryFn: () => fplService.getLiveGameweek(gameweekId),
    enabled: !!gameweekId,
    // Poll every 60s when active; otherwise cache for 5 minutes
    refetchInterval: isLive ? 60_000 : false,
    staleTime: isLive ? 30_000 : 1000 * 60 * 5,
  });
}