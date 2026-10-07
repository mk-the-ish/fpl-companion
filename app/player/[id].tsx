import React, { useMemo } from 'react';
import { View, Text, ScrollView, TouchableOpacity } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useFPLBootstrap } from '../../hooks/useFplData';

export default function PlayerDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { data: bootstrap } = useFPLBootstrap();

  const playerId = parseInt(id || '0', 10);

  const player = useMemo(() => {
    return bootstrap?.elements.find((el) => el.id === playerId);
  }, [bootstrap, playerId]);

  const team = useMemo(() => {
    return bootstrap?.teams.find((t) => t.id === player?.team);
  }, [bootstrap, player]);

  const positionLabel = useMemo(() => {
    const posMap: Record<number, string> = { 1: 'Goalkeeper', 2: 'Defender', 3: 'Midfielder', 4: 'Forward' };
    return player ? posMap[player.element_type] : '';
  }, [player]);

  if (!player) {
    return (
      <View className="flex-1 items-center justify-center bg-slate-950 p-6">
        <Text className="text-base text-slate-400">Player profile not found.</Text>
        <TouchableOpacity onPress={() => router.back()} className="mt-4 rounded-xl bg-slate-800 px-4 py-2">
          <Text className="text-sm font-semibold text-white">Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <ScrollView className="flex-1 bg-slate-950 px-5 py-4">
      {/* Header Info */}
      <View className="flex-row items-center justify-between border-b border-slate-850 pb-5">
        <View>
          <Text className="text-2xl font-black text-white">{player.first_name} {player.second_name}</Text>
          <Text className="text-sm font-semibold text-emerald-400">
            {team?.name} • {positionLabel}
          </Text>
        </View>
        <View className="items-end">
          <Text className="text-2xl font-black text-white">£{(player.now_cost / 10).toFixed(1)}m</Text>
          <Text className="text-xs text-slate-400">Selected: {player.selected_by_percent}%</Text>
        </View>
      </View>

      {/* Key Season Metrics */}
      <View className="mt-5 grid grid-cols-2 gap-3">
        <View className="flex-row justify-between">
          <View className="flex-1 mr-2 rounded-2xl border border-slate-800 bg-slate-900 p-4">
            <Text className="text-xs text-slate-400">Total Points</Text>
            <Text className="mt-1 text-2xl font-black text-emerald-400">{player.total_points}</Text>
          </View>
          <View className="flex-1 ml-2 rounded-2xl border border-slate-800 bg-slate-900 p-4">
            <Text className="text-xs text-slate-400">Form</Text>
            <Text className="mt-1 text-2xl font-black text-white">{player.form}</Text>
          </View>
        </View>
      </View>

      {/* Attacking & Production Breakdown */}
      <View className="mt-5 rounded-2xl border border-slate-800 bg-slate-900 p-5">
        <Text className="text-sm font-bold uppercase tracking-wider text-slate-400 mb-4">
          Underlying Statistics
        </Text>

        <View className="space-y-3">
          <View className="flex-row justify-between py-1 border-b border-slate-850">
            <Text className="text-sm text-slate-300">Goals Scored</Text>
            <Text className="text-sm font-bold text-white">{player.goals_scored}</Text>
          </View>
          <View className="flex-row justify-between py-1 border-b border-slate-850">
            <Text className="text-sm text-slate-300">Expected Goals (xG)</Text>
            <Text className="text-sm font-bold text-emerald-400">{player.expected_goals}</Text>
          </View>
          <View className="flex-row justify-between py-1 border-b border-slate-850">
            <Text className="text-sm text-slate-300">Assists</Text>
            <Text className="text-sm font-bold text-white">{player.assists}</Text>
          </View>
          <View className="flex-row justify-between py-1 border-b border-slate-850">
            <Text className="text-sm text-slate-300">Expected Assists (xA)</Text>
            <Text className="text-sm font-bold text-emerald-400">{player.expected_assists}</Text>
          </View>
          <View className="flex-row justify-between py-1 border-b border-slate-850">
            <Text className="text-sm text-slate-300">ICT Index</Text>
            <Text className="text-sm font-bold text-white">{player.ict_index}</Text>
          </View>
          <View className="flex-row justify-between py-1">
            <Text className="text-sm text-slate-300">Minutes Played</Text>
            <Text className="text-sm font-bold text-white">{player.minutes}</Text>
          </View>
        </View>
      </View>

      <TouchableOpacity
        onPress={() => router.back()}
        className="mt-6 mb-10 items-center justify-center rounded-xl bg-slate-800 py-3.5"
      >
        <Text className="font-bold text-slate-200">Close</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}