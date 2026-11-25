import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, ActivityIndicator, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useUserStore } from '../../stores/useUserStore';
import { useFPLBootstrap } from '../../hooks/useFplData';
import { fplService } from '../../services/fplApi';
import { PitchView } from '../../components/PitchView';
import { evaluateUserSquad } from '../../services/squadOptimizer';
import { FPLPlayer } from '../../types/fpl';
import {
  getAnalysisSourceLabel,
  getMlApiErrorMessage,
  getModelStatus,
  MlAnalysisResult,
  optimizeSquad,
} from '../../services/mlApi';
import type { ModelStatusResponse, OptimizedSquadOutput } from '../../types/mlApi';

export default function MySquadScreen() {
  const router = useRouter();
  const teamId = useUserStore((state) => state.teamId);
  const mlApiBaseUrl = useUserStore((state) => state.mlApiBaseUrl);
  const [viewMode, setViewMode] = useState<'pitch' | 'tactician'>('tactician');
  const modelStatusQuery = useQuery<ModelStatusResponse>({
    queryKey: ['ml-api', 'model-status', mlApiBaseUrl],
    enabled: !!mlApiBaseUrl,
    queryFn: ({ signal }) => getModelStatus(mlApiBaseUrl, signal),
    staleTime: 60_000,
    retry: false,
  });

  const { data: bootstrap, isLoading: isBootstrapLoading } = useFPLBootstrap();
  const nextGW = bootstrap?.events.find((gw) => gw.is_next) || bootstrap?.events.find((gw) => gw.is_current);

  const { data: squadData, isLoading: isSquadLoading } = useQuery({
    queryKey: ['squad-picks', teamId, nextGW?.id],
    queryFn: () => fplService.getSquadPicks(teamId!, nextGW!.id),
    enabled: !!teamId && !!nextGW?.id,
  });

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

  const playersById = useMemo(() => {
    const map = new Map<number, FPLPlayer>();
    bootstrap?.elements.forEach((p) => map.set(p.id, p));
    return map;
  }, [bootstrap]);

  const tacticalQuery = useQuery<MlAnalysisResult<OptimizedSquadOutput>>({
    queryKey: [
      'ml-api',
      'optimize-squad',
      mlApiBaseUrl,
      teamId,
      nextGW?.id,
      squadData?.picks.map((pick) => pick.element).join(','),
      squadData?.entry_history.bank,
    ],
    enabled: !!teamId && !!squadData?.picks && !!bootstrap?.elements && !!fixtures && !!nextGW,
    queryFn: async ({ signal }) => {
      const localResult = () =>
        evaluateUserSquad(
          squadData!.picks,
          bootstrap!.elements,
          fixtures!,
          teamsMap,
          nextGW!.id,
          squadData!.entry_history.bank
        );

      if (!mlApiBaseUrl) {
        return { data: localResult(), source: 'local' };
      }

      try {
        const result = await optimizeSquad(
          mlApiBaseUrl,
          {
            team_id: teamId!,
            gameweek: nextGW!.id,
            free_transfers: 1,
          },
          signal
        );
        if (
          !result ||
          !Array.isArray(result.starters) ||
          result.starters.length !== 11 ||
          !Array.isArray(result.bench) ||
          result.bench.length !== 4 ||
          !result.captain ||
          !result.viceCaptain
        ) {
          throw new Error('The ML API returned an invalid squad optimization response.');
        }
        return { data: result, source: 'backend' };
      } catch (error) {
        if (signal.aborted) throw error;
        return {
          data: localResult(),
          source: 'local',
          fallbackReason: getMlApiErrorMessage(error),
        };
      }
    },
  });

  const tacticalDecisions = tacticalQuery.data?.data ?? null;

  if (!teamId) {
    return (
      <View className="flex-1 items-center justify-center bg-slate-950 px-6">
        <Text className="text-center text-lg font-bold text-white">No FPL Team Connected</Text>
        <Text className="mt-2 text-center text-sm text-slate-400">
          Connect your team ID to unlock lineup optimizations, bench decisions, and transfer advice.
        </Text>
        <TouchableOpacity onPress={() => router.push('/setup')} className="mt-6 rounded-xl bg-emerald-400 px-6 py-3">
          <Text className="font-bold text-slate-950">Connect Team</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (isBootstrapLoading || isSquadLoading || isFixturesLoading || tacticalQuery.isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-slate-950">
        <ActivityIndicator size="large" color="#00ff87" />
        <Text className="mt-3 text-sm text-slate-400">Analyzing Your 15-Man Roster...</Text>
      </View>
    );
  }

  return (
    <ScrollView className="flex-1 bg-slate-950 px-4 py-3">
      {/* View Switcher Header */}
      <View className="mb-4 flex-row items-center justify-between">
        <View>
          <Text className="text-xl font-black text-white">{nextGW?.name ?? 'Matchday'}</Text>
          <Text className="text-xs text-slate-400">
            Bank: £{((squadData?.entry_history.bank ?? 0) / 10).toFixed(1)}m
          </Text>
        </View>

        {tacticalQuery.data ? (
          <View className={`mb-4 rounded-xl border p-3 ${tacticalQuery.data.source === 'backend' ? 'border-emerald-800 bg-emerald-950/30' : 'border-amber-800 bg-amber-950/30'}`}>
            <Text className={`text-xs font-semibold ${tacticalQuery.data.source === 'backend' ? 'text-emerald-300' : 'text-amber-300'}`}>
              {getAnalysisSourceLabel(tacticalQuery.data.source, modelStatusQuery.data)}
              {tacticalQuery.data.source === 'local' && mlApiBaseUrl
                ? ` ML API unavailable; ${tacticalQuery.data.fallbackReason ?? ''}`
                : null}
              {tacticalQuery.data.source === 'local' && !mlApiBaseUrl
                ? ' Add an ML API URL in Settings to enable backend predictions.'
                : null}
            </Text>
          </View>
        ) : null}

        <View className="flex-row rounded-xl bg-slate-900 p-1 border border-slate-800">
          <TouchableOpacity
            onPress={() => setViewMode('tactician')}
            className={`rounded-lg px-3 py-1.5 ${viewMode === 'tactician' ? 'bg-emerald-400' : 'bg-transparent'}`}
          >
            <Text className={`text-xs font-bold ${viewMode === 'tactician' ? 'text-slate-950' : 'text-slate-400'}`}>
              AI Tactician
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setViewMode('pitch')}
            className={`rounded-lg px-3 py-1.5 ${viewMode === 'pitch' ? 'bg-emerald-400' : 'bg-transparent'}`}
          >
            <Text className={`text-xs font-bold ${viewMode === 'pitch' ? 'text-slate-950' : 'text-slate-400'}`}>
              Pitch
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Mode 1: Pitch View */}
      {viewMode === 'pitch' && squadData?.picks && (
        <PitchView
          picks={squadData.picks}
          playersById={playersById}
          onSelectPlayer={(id) => router.push(`/player/${id}` as any)}
        />
      )}

      {/* Mode 2: AI Tactician Mode */}
      {viewMode === 'tactician' && tacticalDecisions && (
        <View className="space-y-4">
          {/* Captain & Vice Recommendation Card */}
          <View className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
            <View className="flex-row items-center justify-between mb-3 border-b border-slate-800 pb-3">
              <View className="flex-row items-center">
                <Ionicons name="shield-checkmark" size={18} color="#00ff87" />
                <Text className="ml-2 text-sm font-black text-white">Captaincy Recommendation</Text>
              </View>
              <Text className="text-[10px] text-slate-500 uppercase tracking-wider font-bold">10k Monte Carlo</Text>
            </View>

            <View className="flex-row items-center justify-between">
              <View className="flex-1">
                <Text className="text-base font-black text-white">{tacticalDecisions.captain.player.web_name} (C)</Text>
                <Text className="text-xs text-slate-400">
                  vs {tacticalDecisions.captain.matchups[0]?.opponentShort ?? 'No fixture'} ({tacticalDecisions.captain.matchups[0]?.isHome ? 'H' : 'A'}) • xP: {tacticalDecisions.captain.xP}
                </Text>
              </View>
              <View className="items-end">
                <Text className="text-base font-black text-emerald-400">{tacticalDecisions.captain.haulProbability}%</Text>
                <Text className="text-[10px] text-slate-500">Haul Probability (≥10 pts)</Text>
              </View>
            </View>
          </View>

          {/* Transfer Recommendation Card */}
          {tacticalDecisions.transferSuggestions.length > 0 && (
            <View className="rounded-2xl border border-purple-900/40 bg-purple-950/20 p-4">
              <Text className="text-xs font-bold text-purple-300 uppercase tracking-wider mb-2">Priority Move</Text>
              <View className="flex-row items-center justify-between">
                <View className="flex-1">
                  <Text className="text-xs text-rose-400 line-through">
                    Sell: {tacticalDecisions.transferSuggestions[0].sellCandidate.player.web_name}
                  </Text>
                  <Text className="text-sm font-black text-emerald-300">
                    Buy: {tacticalDecisions.transferSuggestions[0].buyCandidate.web_name}
                  </Text>
                </View>
                <View className="rounded-xl bg-purple-900/60 px-2.5 py-1.5 border border-purple-700/50">
                  <Text className="text-xs font-black text-purple-200">
                    +{tacticalDecisions.transferSuggestions[0].deltaXP} xP Gain
                  </Text>
                </View>
              </View>
            </View>
          )}

          {/* Starting XI List */}
          <View className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
            <Text className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3">Optimal Starting XI</Text>
            {tacticalDecisions.starters.map((item) => (
              <TouchableOpacity
                key={item.player.id}
                onPress={() => router.push(`/player/${item.player.id}` as any)}
                className="flex-row items-center justify-between py-2.5 border-b border-slate-850"
              >
                <View>
                  <Text className="text-sm font-bold text-white">{item.player.web_name}</Text>
                  <Text className="text-[11px] text-slate-400">
                    vs {item.matchups[0]?.opponentShort ?? 'No fixture'} ({item.matchups[0]?.isHome ? 'H' : 'A'}) • FDR {item.matchups[0]?.fdr ?? '-'}
                  </Text>
                </View>
                <Text className="text-sm font-black text-emerald-400">{item.xP} xP</Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Bench Order */}
          <View className="rounded-2xl border border-slate-800 bg-slate-900 p-4 mb-6">
            <Text className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3">Bench Priority</Text>
            {tacticalDecisions.bench.map((item, index) => (
              <View key={item.player.id} className="flex-row items-center justify-between py-2">
                <Text className="text-xs text-slate-400">
                  {index === tacticalDecisions.bench.length - 1 ? 'GKP 2' : `Sub ${index + 1}`}: {item.player.web_name}
                </Text>
                <Text className="text-xs font-bold text-slate-500">{item.xP} xP</Text>
              </View>
            ))}
          </View>
        </View>
      )}

      <View className="h-10" />
    </ScrollView>
  );
}