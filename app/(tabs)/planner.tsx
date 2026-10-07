import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useFPLBootstrap } from '../../hooks/useFplData';
import { fplService } from '../../services/fplApi';
import { useUserStore } from '../../stores/useUserStore';
import { calculateCaptaincyPicks } from '../../services/recommender';
import { FPLPlayer } from '../../types/fpl';

export default function PlannerScreen() {
  const router = useRouter();
  const teamId = useUserStore((state) => state.teamId);
  const [activeTab, setActiveTab] = useState<'captain' | 'differentials'>('captain');

  const { data: bootstrap, isLoading: isBootstrapLoading } = useFPLBootstrap();

  const nextGW = useMemo(() => {
    return bootstrap?.events.find((gw) => gw.is_next) || bootstrap?.events.find((gw) => gw.is_current);
  }, [bootstrap]);

  // Fetch squad picks to score captaincy for your squad
  const { data: squadData } = useQuery({
    queryKey: ['squad-picks', teamId, nextGW?.id],
    queryFn: () => fplService.getSquadPicks(teamId!, nextGW!.id),
    enabled: !!teamId && !!nextGW?.id,
  });

  // Fetch fixtures for FDR evaluation
  const { data: fixtures, isLoading: isFixturesLoading } = useQuery({
    queryKey: ['fpl-fixtures'],
    queryFn: () => fplService.getFixtures(),
    staleTime: 1000 * 60 * 60 * 12, // 12 hours
  });

  const teamsMap = useMemo(() => {
    const map = new Map<number, string>();
    bootstrap?.teams.forEach((t) => map.set(t.id, t.short_name));
    return map;
  }, [bootstrap]);

  // Captain recommendations (scored from user's starting squad or top 50 in-form overall)
  const captainPicks = useMemo(() => {
    if (!bootstrap?.elements || !fixtures || !nextGW) return [];

    let candidatePool: FPLPlayer[] = [];

    if (squadData?.picks) {
      const pickIds = new Set(squadData.picks.map((p) => p.element));
      candidatePool = bootstrap.elements.filter((el) => pickIds.has(el.id));
    } else {
      // Fallback if no team connected: top attackers/midfielders by form
      candidatePool = bootstrap.elements
        .filter((el) => el.element_type === 3 || el.element_type === 4)
        .sort((a, b) => parseFloat(b.form) - parseFloat(a.form))
        .slice(0, 20);
    }

    return calculateCaptaincyPicks(candidatePool, fixtures, teamsMap, nextGW.id).slice(0, 5);
  }, [bootstrap, fixtures, nextGW, squadData, teamsMap]);

  // Low ownership high-form differentials (< 10% owned)
  const differentials = useMemo(() => {
    if (!bootstrap?.elements || !fixtures || !nextGW) return [];

    const diffPool = bootstrap.elements.filter(
      (el) => parseFloat(el.selected_by_percent) < 10 && (el.status === 'a' || el.status === 'd')
    );

    return calculateCaptaincyPicks(diffPool, fixtures, teamsMap, nextGW.id).slice(0, 6);
  }, [bootstrap, fixtures, nextGW, teamsMap]);

  const isLoading = isBootstrapLoading || isFixturesLoading;

  if (isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-slate-950">
        <ActivityIndicator size="large" color="#00ff87" />
        <Text className="mt-3 text-sm text-slate-400">Computing Algorithmic Picks...</Text>
      </View>
    );
  }

  const displayedList = activeTab === 'captain' ? captainPicks : differentials;

  return (
    <ScrollView className="flex-1 bg-slate-950 px-4 py-3">
      {/* Target Gameweek Indicator */}
      <View className="mb-4 flex-row items-center justify-between rounded-2xl border border-slate-800 bg-slate-900 p-4">
        <View>
          <Text className="text-xs uppercase tracking-wider text-slate-400">Target Decision</Text>
          <Text className="text-lg font-black text-white">{nextGW?.name ?? 'Next Round'}</Text>
        </View>
        <View className="rounded-xl bg-purple-950/80 px-3 py-1.5 border border-purple-800/50">
          <Text className="text-xs font-bold text-purple-300">Model Engine v1.0</Text>
        </View>
      </View>

      {/* Mode Toggle */}
      <View className="mb-4 flex-row rounded-xl bg-slate-900 p-1">
        <TouchableOpacity
          onPress={() => setActiveTab('captain')}
          className={`flex-1 items-center rounded-lg py-2.5 ${
            activeTab === 'captain' ? 'bg-emerald-500' : 'bg-transparent'
          }`}
        >
          <Text className={`text-xs font-bold ${activeTab === 'captain' ? 'text-slate-950' : 'text-slate-400'}`}>
            Captain Index
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => setActiveTab('differentials')}
          className={`flex-1 items-center rounded-lg py-2.5 ${
            activeTab === 'differentials' ? 'bg-emerald-500' : 'bg-transparent'
          }`}
        >
          <Text className={`text-xs font-bold ${activeTab === 'differentials' ? 'text-slate-950' : 'text-slate-400'}`}>
            Differential Radar (&lt;10%)
          </Text>
        </TouchableOpacity>
      </View>

      {/* Cards List */}
      <View className="space-y-3">
        {displayedList.map((item, idx) => {
          const fdrColor =
            item.fdr <= 2 ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40' :
            item.fdr === 3 ? 'bg-slate-700 text-slate-200 border-slate-600' :
            'bg-rose-500/20 text-rose-400 border-rose-500/40';

          return (
            <TouchableOpacity
              key={item.player.id}
              onPress={() => router.push(`/player/${item.player.id}` as any)}
              className="mb-3 rounded-2xl border border-slate-800 bg-slate-900 p-4 shadow-sm"
            >
              <View className="flex-row items-center justify-between">
                <View className="flex-row items-center">
                  <View className="h-7 w-7 items-center justify-center rounded-full bg-slate-800">
                    <Text className="text-xs font-bold text-slate-400">#{idx + 1}</Text>
                  </View>
                  <View className="ml-3">
                    <Text className="text-base font-bold text-white">{item.player.web_name}</Text>
                    <Text className="text-xs text-slate-400">
                      Form: {item.player.form} • £{(item.player.now_cost / 10).toFixed(1)}m
                    </Text>
                  </View>
                </View>

                {/* Algorithmic Confidence Index */}
                <View className="items-end">
                  <View className="flex-row items-center">
                    <Ionicons name="flame-outline" size={12} color="#00ff87" />
                    <Text className="ml-1 text-lg font-black text-emerald-400">{item.score}</Text>
                    <Text className="text-[10px] text-slate-500">/100</Text>
                  </View>
                  <Text className="text-[10px] text-slate-500">Confidence</Text>
                </View>
              </View>

              {/* Matchup strip */}
              <View className="mt-3 flex-row items-center justify-between border-t border-slate-850 pt-3">
                <Text className="text-xs text-slate-400">
                  Fixture: vs {item.opponentShortName} ({item.isHome ? 'H' : 'A'})
                </Text>
                <View className={`rounded-md border px-2 py-0.5 ${fdrColor}`}>
                  <Text className="text-[10px] font-black uppercase">FDR {item.fdr}</Text>
                </View>
              </View>
            </TouchableOpacity>
          );
        })}
      </View>

      <View className="h-10" />
    </ScrollView>
  );
}