import React from 'react';
import { View, Text, TouchableOpacity, Alert, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { useUserStore } from '../../stores/useUserStore';

export default function SettingsScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const teamId = useUserStore((state) => state.teamId);
  const setTeamId = useUserStore((state) => state.setTeamId);

  const handleDisconnect = () => {
    Alert.alert(
      'Disconnect Team',
      'Are you sure you want to unlink your FPL Team ID?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Unlink',
          style: 'destructive',
          onPress: () => {
            setTeamId(0);
            queryClient.clear();
            Alert.alert('Unlinked', 'Your FPL squad has been disconnected.');
          },
        },
      ]
    );
  };

  const handleClearCache = () => {
    queryClient.clear();
    Alert.alert('Cache Cleared', 'All stored FPL gameweek and fixture data refreshed.');
  };

  return (
    <ScrollView className="flex-1 bg-slate-950 px-5 py-4">
      {/* Account / Linked Squad Section */}
      <Text className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-500">
        Connected Squad
      </Text>
      <View className="mb-6 rounded-2xl border border-slate-800 bg-slate-900 p-4">
        <View className="flex-row items-center justify-between">
          <View>
            <Text className="text-base font-bold text-white">
              {teamId ? `FPL Entry #${teamId}` : 'No Squad Linked'}
            </Text>
            <Text className="text-xs text-slate-400">
              {teamId ? 'Linked to official FPL servers' : 'Link an ID to unlock My Team and Leagues'}
            </Text>
          </View>
          <TouchableOpacity
            onPress={() => router.push('/setup')}
            className="rounded-xl bg-slate-800 px-3 py-2 border border-slate-700"
          >
            <Text className="text-xs font-bold text-emerald-400">
              {teamId ? 'Change' : 'Link'}
            </Text>
          </TouchableOpacity>
        </View>

        {teamId ? (
          <TouchableOpacity
            onPress={handleDisconnect}
            className="mt-4 items-center justify-center rounded-xl bg-rose-500/10 py-2.5 border border-rose-500/20"
          >
            <Text className="text-xs font-bold text-rose-400">Unlink Squad</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      {/* Data & Performance Section */}
      <Text className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-500">
        Data & Cache
      </Text>
      <View className="mb-6 rounded-2xl border border-slate-800 bg-slate-900 p-4">
        <TouchableOpacity
          onPress={handleClearCache}
          className="flex-row items-center justify-between py-1"
        >
          <View className="flex-row items-center">
            <Ionicons name="refresh-circle-outline" size={22} color="#00ff87" />
            <Text className="ml-3 text-sm font-semibold text-white">Clear Query Cache</Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color="#64748b" />
        </TouchableOpacity>
      </View>

      {/* App Info */}
      <View className="items-center py-6">
        <Text className="text-xs font-bold text-slate-600">FPL Companion v2.0</Text>
        <Text className="text-[11px] text-slate-700 mt-0.5">Built with React Native & Expo Router</Text>
      </View>
    </ScrollView>
  );
}