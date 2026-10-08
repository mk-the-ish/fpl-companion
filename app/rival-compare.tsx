import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useFPLBootstrap } from '../hooks/useFplData';
import { FPLPlayer } from '../types/fpl';

export default function RivalCompareScreen() {
  const router = useRouter();
  const { data: bootstrap } = useFPLBootstrap();

  // Default to comparing the top 2 overall point scorers
  const sortedPlayers = useMemo(() => {
    return [...(bootstrap?.elements ?? [])].sort((a, b) => b.total_points - a.total_points);
  }, [bootstrap]);

  const [playerAId, setPlayerAId] = useState<number | null>(null);
  const [playerBId, setPlayerBId] = useState<number | null>(null);

  const playerA = sortedPlayers.find((p) => p.id === (playerAId ?? sortedPlayers[0]?.id));
  const playerB = sortedPlayers.find((p) => p.id === (playerBId ?? sortedPlayers[1]?.id));

  const renderMetricRow = (label: string, valA: string | number, valB: string | number) => {
    const numA = typeof valA === 'string' ? parseFloat(valA) : valA;
    const numB = typeof valB === 'string' ? parseFloat(valB) : valB;
    const aWins = !isNaN(numA) && !isNaN(numB) && numA > numB;
    const bWins = !isNaN(numA) && !isNaN(numB) && numB > numA;

    return (
      <View className="flex-row items-center justify-between border-b border-slate-800 py-3">
        <Text className={`w-20 text-center font-bold ${aWins ? 'text-emerald-400 font-black' : 'text-slate-300'}`}>
          {valA}
        </Text>
        <Text className="flex-1 text-center text-xs font-semibold uppercase tracking-wider text-slate-500">
          {label}
        </Text>
        <Text className={`w-20 text-center font-bold ${bWins ? 'text-emerald-400 font-black' : 'text-slate-300'}`}>
          {valB}
        </Text>
      </View>
    );
  };

  return (
    <ScrollView className="flex-1 bg-slate-950 px-4 py-4">
      {/* Header Cards */}
      <View className="flex-row items-center justify-between">
        {/* Player A */}
        <View className="flex-1 rounded-2xl border border-slate-800 bg-slate-900 p-4 mr-2 items-center">
          <Text numberOfLines={1} className="text-base font-black text-white">{playerA?.web_name ?? 'Player 1'}</Text>
          <Text className="text-xs text-emerald-400 mt-0.5">£{((playerA?.now_cost ?? 0) / 10).toFixed(1)}m</Text>
        </View>

        <View className="h-8 w-8 items-center justify-center rounded-full bg-slate-800">
          <Text className="text-xs font-black text-slate-400">VS</Text>
        </View>

        {/* Player B */}
        <View className="flex-1 rounded-2xl border border-slate-800 bg-slate-900 p-4 ml-2 items-center">
          <Text numberOfLines={1} className="text-base font-black text-white">{playerB?.web_name ?? 'Player 2'}</Text>
          <Text className="text-xs text-emerald-400 mt-0.5">£{((playerB?.now_cost ?? 0) / 10).toFixed(1)}m</Text>
        </View>
      </View>

      {/* Comparison Grid */}
      <View className="mt-6 rounded-2xl border border-slate-800 bg-slate-900 p-4">
        {playerA && playerB && (
          <>
            {renderMetricRow('Total Points', playerA.total_points, playerB.total_points)}
            {renderMetricRow('Form', playerA.form, playerB.form)}
            {renderMetricRow('Goals', playerA.goals_scored, playerB.goals_scored)}
            {renderMetricRow('Assists', playerA.assists, playerB.assists)}
            {renderMetricRow('xG', playerA.expected_goals, playerB.expected_goals)}
            {renderMetricRow('xA', playerA.expected_assists, playerB.expected_assists)}
            {renderMetricRow('ICT Index', playerA.ict_index, playerB.ict_index)}
            {renderMetricRow('Selected %', `${playerA.selected_by_percent}%`, `${playerB.selected_by_percent}%`)}
          </>
        )}
      </View>

      <TouchableOpacity
        onPress={() => router.back()}
        className="mt-6 items-center justify-center rounded-xl bg-slate-850 py-3.5"
      >
        <Text className="font-bold text-slate-300">Close Comparison</Text>
      </TouchableOpacity>
      <View className="h-8" />
    </ScrollView>
  );
}