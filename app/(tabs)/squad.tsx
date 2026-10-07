import React, { useMemo } from 'react';
import { View, Text, ScrollView, ActivityIndicator, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useUserStore } from '../../stores/useUserStore';
import { useFPLBootstrap } from '../../hooks/useFplData';
import { fplService } from '../../services/fplApi';
import { PitchView } from '../../components/PitchView';
import { FPLPlayer } from '../../types/fpl';

export default function MySquadScreen() {
  const router = useRouter();
  const teamId = useUserStore((state) => state.teamId);
  const { data: bootstrap, isLoading: isBootstrapLoading } = useFPLBootstrap();

  const currentGW = bootstrap?.events.find((gw) => gw.is_current) || bootstrap?.events[0];

  const { data: squadData, isLoading: isSquadLoading } = useQuery({
    queryKey: ['squad-picks', teamId, currentGW?.id],
    queryFn: () => fplService.getSquadPicks(teamId!, currentGW!.id),
    enabled: !!teamId && !!currentGW?.id,
  });

  // Map elements array into a fast O(1) Lookup Map
  const playersById = useMemo(() => {
    const map = new Map<number, FPLPlayer>();
    if (bootstrap?.elements) {
      for (const p of bootstrap.elements) {
        map.set(p.id, p);
      }
    }
    return map;
  }, [bootstrap]);

  if (!teamId) {
    return (
      <View className="flex-1 items-center justify-center bg-slate-950 px-6">
        <Text className="text-center text-lg font-bold text-white">No FPL Team Connected</Text>
        <Text className="mt-2 text-center text-sm text-slate-400">
          Connect your team ID to unlock pitch lineup visualizations and personal stats.
        </Text>
        <TouchableOpacity
          onPress={() => router.push('/setup')}
          className="mt-6 rounded-xl bg-emerald-400 px-6 py-3"
        >
          <Text className="font-bold text-slate-950">Connect Team</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (isBootstrapLoading || isSquadLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-slate-950">
        <ActivityIndicator size="large" color="#00ff87" />
        <Text className="mt-3 text-sm text-slate-400">Loading Pitch Lineup...</Text>
      </View>
    );
  }

  return (
    <ScrollView className="flex-1 bg-slate-950 p-4">
      <View className="mb-4 flex-row items-center justify-between">
        <View>
          <Text className="text-xl font-bold text-white">{currentGW?.name}</Text>
          <Text className="text-xs text-slate-400">
            Overall Rank: {squadData?.entry_history.overall_rank?.toLocaleString() ?? 'N/A'}
          </Text>
        </View>
        <View className="rounded-xl bg-slate-800 px-3 py-1.5">
          <Text className="text-xs font-bold text-emerald-400">
            Bank: £{((squadData?.entry_history.bank ?? 0) / 10).toFixed(1)}m
          </Text>
        </View>
      </View>

      {squadData?.picks && (
        <PitchView
          picks={squadData.picks}
          playersById={playersById}
          onSelectPlayer={(id) => router.push(`/player/${id}` as any)}
        />
      )}
    </ScrollView>
  );
}