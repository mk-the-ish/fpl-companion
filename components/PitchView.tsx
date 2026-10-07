import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { FPLPlayer, FPLPick } from '../types/fpl';

interface PitchViewProps {
  picks: FPLPick[];
  playersById: Map<number, FPLPlayer>;
  onSelectPlayer: (id: number) => void;
}

export function PitchView({ picks, playersById, onSelectPlayer }: PitchViewProps) {
  const starters = picks.filter((p) => p.position <= 11);
  const bench = picks.filter((p) => p.position > 11);

  // Group starters by element_type (1: GKP, 2: DEF, 3: MID, 4: FWD)
  const gks = starters.filter((p) => playersById.get(p.element)?.element_type === 1);
  const defs = starters.filter((p) => playersById.get(p.element)?.element_type === 2);
  const mids = starters.filter((p) => playersById.get(p.element)?.element_type === 3);
  const fwds = starters.filter((p) => playersById.get(p.element)?.element_type === 4);

  const renderPlayerBadge = (pick: FPLPick) => {
    const player = playersById.get(pick.element);
    if (!player) return null;

    return (
      <TouchableOpacity
        key={pick.element}
        onPress={() => onSelectPlayer(pick.element)}
        className="items-center px-1"
        style={{ width: `${100 / Math.max(defs.length, mids.length, 3)}%` }}
      >
        <View className="relative h-11 w-11 items-center justify-center rounded-full border border-slate-600 bg-slate-800">
          <Text className="text-xs font-black text-white">{player.web_name.substring(0, 3)}</Text>
          {pick.is_captain && (
            <View className="absolute -bottom-1 -right-1 h-5 w-5 items-center justify-center rounded-full bg-yellow-400">
              <Text className="text-[10px] font-black text-slate-900">C</Text>
            </View>
          )}
          {pick.is_vice_captain && (
            <View className="absolute -bottom-1 -right-1 h-5 w-5 items-center justify-center rounded-full bg-slate-300">
              <Text className="text-[10px] font-black text-slate-900">V</Text>
            </View>
          )}
        </View>
        <Text numberOfLines={1} className="mt-1 text-[11px] font-semibold text-slate-200">
          {player.web_name}
        </Text>
        <Text className="text-[10px] text-emerald-400">
          £{(player.now_cost / 10).toFixed(1)}m
        </Text>
      </TouchableOpacity>
    );
  };

  return (
    <View className="flex-1">
      {/* The Football Pitch Background */}
      <View className="min-h-[460px] justify-around rounded-3xl border border-emerald-900/60 bg-emerald-950/40 p-4">
        {/* Goalkeeper row */}
        <View className="flex-row justify-center">{gks.map(renderPlayerBadge)}</View>

        {/* Defenders row */}
        <View className="flex-row justify-around">{defs.map(renderPlayerBadge)}</View>

        {/* Midfielders row */}
        <View className="flex-row justify-around">{mids.map(renderPlayerBadge)}</View>

        {/* Forwards row */}
        <View className="flex-row justify-around">{fwds.map(renderPlayerBadge)}</View>
      </View>

      {/* Bench Section */}
      <View className="mt-4 rounded-2xl border border-slate-800 bg-slate-900/80 p-3">
        <Text className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-400">
          Bench
        </Text>
        <View className="flex-row justify-around">{bench.map(renderPlayerBadge)}</View>
      </View>
    </View>
  );
}