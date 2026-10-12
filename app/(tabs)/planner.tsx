import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useFPLBootstrap } from '../../hooks/useFplData';
import { fplService } from '../../services/fplApi';
import { generateMultiGameweekPicks, UpcomingMatch } from '../../services/recommenderV2';

export default function PlannerScreen() {
  const router = useRouter();
  const [selectedPos, setSelectedPos] = useState<number>(3); // Default to MID (3)

  const { data: bootstrap, isLoading: isBootstrapLoading } = useFPLBootstrap();

  const nextGW = useMemo(() => {
    return bootstrap?.events.find((gw) => gw.is_next) || bootstrap?.events.find((gw) => gw.is_current);
  }, [bootstrap]);

  const { data: fixtures, isLoading: isFixturesLoading } = useQuery({
    queryKey: ['fpl-fixtures'],
    queryFn: () => fplService.getFixtures(),
    staleTime: 1000 * 60 * 60 * 12,
  });

  const teamsMap = useMemo(() => {
    const map = new Map<number, string>();
    bootstrap?.teams.forEach((t) => map.set(t.id, t.short_name));
    return map;
  }, [bootstrap]);

  // Compute 4-GW recommendations for selected position
  const recommendations = useMemo(() => {
    if (!bootstrap?.elements || !fixtures || !nextGW) return [];
    return generateMultiGameweekPicks(
      bootstrap.elements,
      fixtures,
      teamsMap,
      nextGW.id,
      selectedPos
    ).slice(0, 10);
  }, [bootstrap, fixtures, nextGW, teamsMap, selectedPos]);

  const posTabs = [
    { id: 1, label: 'GKP' },
    { id: 2, label: 'DEF' },
    { id: 3, label: 'MID' },
    { id: 4, label: 'FWD' },
  ];

  const getFDRBadgeColor = (fdr: number) => {
    if (fdr <= 2) return 'bg-emerald-950 border-emerald-500/50 text-emerald-400';
    if (fdr === 3) return 'bg-slate-800 border-slate-700 text-slate-300';
    return 'bg-rose-950 border-rose-500/50 text-rose-400';
  };

  const isLoading = isBootstrapLoading || isFixturesLoading;

  if (isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-slate-950">
        <ActivityIndicator size="large" color="#00ff87" />
        <Text className="mt-3 text-sm text-slate-400">Projecting 4-GW Strategy Engine...</Text>
      </View>
    );
  }

  return (
    <ScrollView className="flex-1 bg-slate-950 px-4 py-3">
      {/* Strategy Scope Banner */}
      <View className="mb-4 rounded-2xl border border-slate-800 bg-slate-900 p-4">
        <View className="flex-row items-center justify-between">
          <View>
            <Text className="text-xs uppercase tracking-wider text-slate-400">Planning Horizon</Text>
            <Text className="text-lg font-black text-white">
              GW {nextGW?.id} – GW {(nextGW?.id ?? 1) + 3}
            </Text>
          </View>
          <View className="rounded-xl border border-emerald-500/30 bg-emerald-950/40 px-3 py-1.5">
            <Text className="text-xs font-bold text-emerald-300">4-Week Projection</Text>
          </View>
        </View>
      </View>

      {/* Position Selector Bar */}
      <View className="mb-4 flex-row rounded-xl bg-slate-900 p-1">
        {posTabs.map((tab) => {
          const isActive = selectedPos === tab.id;
          return (
            <TouchableOpacity
              key={tab.id}
              onPress={() => setSelectedPos(tab.id)}
              className={`flex-1 items-center rounded-lg py-2 ${isActive ? 'bg-emerald-400' : 'bg-transparent'}`}
            >
              <Text className={`text-xs font-extrabold ${isActive ? 'text-slate-950' : 'text-slate-400'}`}>
                {tab.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Recommended Player Cards */}
      <View className="space-y-3">
        {recommendations.map((item, idx) => (
          <TouchableOpacity
            key={item.player.id}
            onPress={() => router.push(`/player/${item.player.id}` as any)}
            className="mb-3 rounded-2xl border border-slate-800 bg-slate-900 p-4 shadow-sm"
          >
            {/* Header: Rank, Player Name, Model Confidence */}
            <View className="flex-row items-center justify-between">
              <View className="flex-row items-center">
                <View className="h-7 w-7 items-center justify-center rounded-full bg-slate-800">
                  <Text className="text-xs font-black text-slate-400">#{idx + 1}</Text>
                </View>
                <View className="ml-3">
                  <Text className="text-base font-bold text-white">{item.player.web_name}</Text>
                  <Text className="text-xs text-slate-400">
                    £{(item.player.now_cost / 10).toFixed(1)}m • {selectedPos <= 2 ? `CS/xGC Index: ${item.per90Metric}` : `xGI/90: ${item.per90Metric}`}
                  </Text>
                </View>
              </View>

              <View className="items-end">
                <View className="flex-row items-center">
                  <Ionicons name="flash" size={12} color="#00ff87" />
                  <Text className="ml-1 text-lg font-black text-emerald-400">{item.projectedScore}</Text>
                  <Text className="text-[10px] text-slate-500">/100</Text>
                </View>
                <Text className="text-[10px] text-slate-500">Avg FDR: {item.avgFDR}</Text>
              </View>
            </View>

            {/* 4-Gameweek Fixture Run Strip */}
            <View className="mt-3 flex-row justify-between border-t border-slate-850 pt-3">
              {item.upcomingMatches.map((m: UpcomingMatch, i: number) => {
                const colorClass = getFDRBadgeColor(m.fdr);
                return (
                  <View
                    key={i}
                    className={`flex-1 mx-0.5 items-center rounded-lg border py-1.5 px-1 ${colorClass}`}
                  >
                    <Text className="text-[10px] font-black">{m.opponentShort}</Text>
                    <Text className="text-[9px] font-medium text-slate-400">
                      {m.isHome ? '(H)' : '(A)'}
                    </Text>
                  </View>
                );
              })}
            </View>
          </TouchableOpacity>
        ))}
      </View>

      <View className="h-10" />
    </ScrollView>
  );
}