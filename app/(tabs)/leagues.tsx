import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useUserStore } from '../../stores/useUserStore';
import { fplService } from '../../services/fplApi';
import { FPLLeagueSummary } from '../../types/fpl';

export default function LeaguesScreen() {
  const router = useRouter();
  const teamId = useUserStore((state) => state.teamId);
  const [selectedLeague, setSelectedLeague] = useState<FPLLeagueSummary | null>(null);

  // 1. Fetch user's entry details and league memberships
  const { data: entryData, isLoading: isEntryLoading } = useQuery({
    queryKey: ['fpl-entry-summary', teamId],
    queryFn: () => fplService.getEntrySummary(teamId!),
    enabled: !!teamId,
  });

  // 2. Fetch standings of the selected league
  const activeLeagueId = selectedLeague?.id ?? entryData?.leagues?.classic?.[0]?.id;

  const { data: standingsData, isLoading: isStandingsLoading } = useQuery({
    queryKey: ['fpl-league-standings', activeLeagueId],
    queryFn: () => fplService.getLeagueStandings(activeLeagueId!),
    enabled: !!activeLeagueId,
  });

  if (!teamId) {
    return (
      <View className="flex-1 items-center justify-center bg-slate-950 px-6">
        <Text className="text-center text-lg font-bold text-white">No Team Linked</Text>
        <Text className="mt-2 text-center text-sm text-slate-400">
          Link your FPL Team ID to view your private mini-leagues and rival standings.
        </Text>
        <TouchableOpacity
          onPress={() => router.push('/setup')}
          className="mt-6 rounded-xl bg-emerald-400 px-6 py-3"
        >
          <Text className="font-bold text-slate-950">Link Team</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (isEntryLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-slate-950">
        <ActivityIndicator size="large" color="#00ff87" />
        <Text className="mt-3 text-sm text-slate-400">Fetching Mini-Leagues...</Text>
      </View>
    );
  }

  const classicLeagues = entryData?.leagues?.classic ?? [];

  return (
    <ScrollView className="flex-1 bg-slate-950 px-4 py-3">
      {/* Horizontal League Selector Carousel */}
      <Text className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-400">
        Your Mini-Leagues
      </Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mb-4">
        {classicLeagues.map((lg) => {
          const isSelected = activeLeagueId === lg.id;
          return (
            <TouchableOpacity
              key={lg.id}
              onPress={() => setSelectedLeague(lg)}
              className={`mr-2.5 rounded-xl border px-3.5 py-2.5 ${
                isSelected
                  ? 'border-emerald-400 bg-emerald-950/60'
                  : 'border-slate-800 bg-slate-900'
              }`}
            >
              <Text
                className={`text-xs font-bold ${
                  isSelected ? 'text-emerald-300' : 'text-slate-300'
                }`}
              >
                {lg.name}
              </Text>
              <Text className="mt-0.5 text-[10px] text-slate-500">
                Rank: #{lg.entry_rank?.toLocaleString() ?? '-'}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* Standings Table Card */}
      <View className="rounded-2xl border border-slate-800 bg-slate-900 p-4 shadow-sm">
        <View className="mb-3 flex-row items-center justify-between border-b border-slate-800 pb-3">
          <View>
            <Text className="text-base font-bold text-white">
              {standingsData?.league?.name ?? 'League Standings'}
            </Text>
            <Text className="text-xs text-slate-400">
              {standingsData?.standings?.results?.length ?? 0} Managers Listed
            </Text>
          </View>
          <Ionicons name="trophy" size={20} color="#00ff87" />
        </View>

        {isStandingsLoading ? (
          <View className="py-8 items-center justify-center">
            <ActivityIndicator size="small" color="#00ff87" />
          </View>
        ) : (
          <View>
            {/* Table Header */}
            <View className="mb-2 flex-row justify-between px-1">
              <Text className="w-8 text-[11px] font-bold text-slate-500">POS</Text>
              <Text className="flex-1 text-[11px] font-bold text-slate-500">MANAGER / TEAM</Text>
              <Text className="w-12 text-right text-[11px] font-bold text-slate-500">GW</Text>
              <Text className="w-14 text-right text-[11px] font-bold text-slate-500">TOT</Text>
            </View>

            {/* Manager Rows */}
            {standingsData?.standings?.results?.map((row) => {
              const isCurrentUser = row.entry === teamId;

              return (
                <View
                  key={row.id}
                  className={`flex-row items-center justify-between py-2.5 px-1 border-b border-slate-850 ${
                    isCurrentUser ? 'bg-emerald-950/30 rounded-lg' : ''
                  }`}
                >
                  <View className="w-8">
                    <Text
                      className={`text-xs font-bold ${
                        row.rank === 1 ? 'text-yellow-400' : 'text-slate-400'
                      }`}
                    >
                      {row.rank}
                    </Text>
                  </View>

                  <View className="flex-1 pr-2">
                    <Text
                      numberOfLines={1}
                      className={`text-xs font-semibold ${
                        isCurrentUser ? 'text-emerald-400 font-bold' : 'text-white'
                      }`}
                    >
                      {row.entry_name}
                    </Text>
                    <Text numberOfLines={1} className="text-[10px] text-slate-400">
                      {row.player_name}
                    </Text>
                  </View>

                  <View className="w-12 items-end">
                    <Text className="text-xs font-semibold text-slate-300">
                      {row.event_total}
                    </Text>
                  </View>

                  <View className="w-14 items-end">
                    <Text className="text-xs font-black text-emerald-400">
                      {row.total}
                    </Text>
                  </View>
                </View>
              );
            })}
          </View>
        )}
      </View>

      <View className="h-10" />
    </ScrollView>
  );
}