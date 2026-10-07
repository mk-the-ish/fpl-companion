import React, { useMemo } from 'react';
import { View, Text, ScrollView, ActivityIndicator, TouchableOpacity, RefreshControl } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useFPLBootstrap, useFPLLiveGameweek } from '../../hooks/useFplData';
import { useUserStore } from '../../stores/useUserStore';
import { FPLPlayer } from '../../types/fpl';

export default function LiveHubScreen() {
  const router = useRouter();
  const teamId = useUserStore((state) => state.teamId);

  const {
    data: bootstrap,
    isLoading: isBootstrapLoading,
    refetch: refetchBootstrap,
    isRefetching: isBootstrapRefetching,
  } = useFPLBootstrap();

  // Determine current active gameweek
  const currentGW = useMemo(() => {
    return bootstrap?.events.find((gw) => gw.is_current) || bootstrap?.events[0];
  }, [bootstrap]);

  const {
    data: liveData,
    isLoading: isLiveLoading,
    refetch: refetchLive,
    isRefetching: isLiveRefetching,
  } = useFPLLiveGameweek(currentGW?.id ?? 0, currentGW ? !currentGW.finished : false);

  // Fast map to get player names & teams
  const playersById = useMemo(() => {
    const map = new Map<number, FPLPlayer>();
    if (bootstrap?.elements) {
      for (const player of bootstrap.elements) {
        map.set(player.id, player);
      }
    }
    return map;
  }, [bootstrap]);

  // Extract top performers this gameweek
  const topPerformers = useMemo(() => {
    if (!liveData?.elements) return [];
    return [...liveData.elements]
      .sort((a, b) => b.stats.total_points - a.stats.total_points)
      .slice(0, 5);
  }, [liveData]);

  const isLoading = isBootstrapLoading || isLiveLoading;
  const isRefreshing = isBootstrapRefetching || isLiveRefetching;

  const onRefresh = () => {
    refetchBootstrap();
    if (currentGW?.id) refetchLive();
  };

  if (isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-slate-950">
        <ActivityIndicator size="large" color="#00ff87" />
        <Text className="mt-3 text-sm text-slate-400">Syncing Live Matchday Hub...</Text>
      </View>
    );
  }

  return (
    <ScrollView
      className="flex-1 bg-slate-950 px-4 py-3"
      refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} tintColor="#00ff87" />}
    >
      {/* Team ID Onboarding Banner */}
      {!teamId && (
        <TouchableOpacity
          onPress={() => router.push('/setup')}
          className="mb-4 flex-row items-center justify-between rounded-2xl border border-emerald-500/30 bg-emerald-950/40 p-4"
        >
          <View className="flex-1 pr-3">
            <Text className="text-sm font-bold text-emerald-300">Link your FPL Squad</Text>
            <Text className="text-xs text-slate-300">Track your live squad score, rank changes, and mini-leagues.</Text>
          </View>
          <View className="rounded-xl bg-emerald-400 px-3 py-2">
            <Text className="text-xs font-bold text-slate-950">Link ID</Text>
          </View>
        </TouchableOpacity>
      )}

      {/* Gameweek Summary Card */}
      <View className="rounded-2xl border border-slate-800 bg-slate-900 p-5 shadow-lg">
        <View className="flex-row items-center justify-between">
          <View>
            <Text className="text-xl font-extrabold text-white">{currentGW?.name ?? 'Gameweek'}</Text>
            <Text className="text-xs font-medium text-slate-400">
              {currentGW?.finished ? 'Completed' : 'Matchday In Progress'}
            </Text>
          </View>
          <View className="flex-row items-center rounded-full bg-slate-800 px-3 py-1">
            <View
              className={`mr-2 h-2 w-2 rounded-full ${
                currentGW?.finished ? 'bg-slate-500' : 'bg-emerald-400 animate-pulse'
              }`}
            />
            <Text className="text-xs font-semibold text-slate-300">
              {currentGW?.finished ? 'Full Time' : 'Live'}
            </Text>
          </View>
        </View>

        <View className="mt-5 flex-row justify-between border-t border-slate-800 pt-4">
          <View>
            <Text className="text-xs text-slate-400">Average Points</Text>
            <Text className="text-xl font-black text-emerald-400">{currentGW?.average_entry_score ?? 0}</Text>
          </View>
          <View>
            <Text className="text-xs text-slate-400">Highest Score</Text>
            <Text className="text-xl font-black text-white">{currentGW?.highest_score ?? '-'}</Text>
          </View>
          <View>
            <Text className="text-xs text-slate-400">Transfers Made</Text>
            <Text className="text-xl font-black text-slate-200">
              {currentGW?.transfers_made ? (currentGW.transfers_made / 1_000_000).toFixed(1) + 'M' : '-'}
            </Text>
          </View>
        </View>
      </View>

      {/* Top Performers Section */}
      <View className="mt-6">
        <View className="mb-3 flex-row items-center justify-between">
          <Text className="text-base font-bold text-white">Gameweek Top Scorers</Text>
          <Ionicons name="flame" size={18} color="#00ff87" />
        </View>

        <View className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900">
          {topPerformers.map((item, index) => {
            const player = playersById.get(item.id);
            if (!player) return null;

            return (
              <TouchableOpacity
                key={item.id}
                onPress={() => router.push(`/player/${item.id}` as any)}
                className={`flex-row items-center justify-between p-3.5 ${
                  index !== topPerformers.length - 1 ? 'border-b border-slate-800' : ''
                }`}
              >
                <View className="flex-row items-center">
                  <Text className="w-5 text-xs font-bold text-slate-500">{index + 1}</Text>
                  <View className="ml-2">
                    <Text className="text-sm font-semibold text-white">{player.web_name}</Text>
                    <Text className="text-[11px] text-slate-400">
                      {item.stats.goals_scored > 0 ? `${item.stats.goals_scored}G ` : ''}
                      {item.stats.assists > 0 ? `${item.stats.assists}A ` : ''}
                      {item.stats.bonus > 0 ? `${item.stats.bonus} Bonus` : ''}
                    </Text>
                  </View>
                </View>

                <View className="items-end">
                  <Text className="text-base font-black text-emerald-400">{item.stats.total_points} pts</Text>
                  <Text className="text-[10px] text-slate-500">BPS: {item.stats.bps}</Text>
                </View>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      <View className="h-10" />
    </ScrollView>
  );
}