import React, { useState } from 'react';
import { View, Text, TouchableOpacity, Alert, ScrollView, TextInput } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { useUserStore } from '../../stores/useUserStore';
import { normalizeMlApiBaseUrl } from '../../services/mlApi';

export default function SettingsScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const teamId = useUserStore((state) => state.teamId);
  const setTeamId = useUserStore((state) => state.setTeamId);
  const mlApiBaseUrl = useUserStore((state) => state.mlApiBaseUrl);
  const setMlApiBaseUrl = useUserStore((state) => state.setMlApiBaseUrl);
  const [mlApiInput, setMlApiInput] = useState(mlApiBaseUrl);

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

  const handleSaveMlApiUrl = () => {
    try {
      const normalizedUrl = normalizeMlApiBaseUrl(mlApiInput);
      setMlApiBaseUrl(normalizedUrl ?? '');
      setMlApiInput(normalizedUrl ?? '');
      queryClient.removeQueries({ queryKey: ['ml-api'] });
      Alert.alert(
        'Saved',
        normalizedUrl
          ? 'The ML API server URL has been saved.'
          : 'The ML API URL was cleared. The app will use local projections.'
      );
    } catch (error) {
      Alert.alert(
        'Invalid server URL',
        error instanceof Error ? error.message : 'Enter a valid HTTP or HTTPS URL.'
      );
    }
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

      <Text className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-500">
        Prediction Server
      </Text>
      <View className="mb-6 rounded-2xl border border-slate-800 bg-slate-900 p-4">
        <Text className="mb-2 text-sm font-semibold text-white">ML API Base URL</Text>
        <Text className="mb-3 text-xs leading-5 text-slate-400">
          Optional. Use your server address, for example http://192.168.1.10:8000. Leave blank to use local projections.
        </Text>
        <TextInput
          accessibilityLabel="ML API base URL"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          onChangeText={setMlApiInput}
          placeholder="http://192.168.1.10:8000"
          placeholderTextColor="#64748b"
          value={mlApiInput}
          className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-3 text-sm text-white"
        />
        <TouchableOpacity
          accessibilityRole="button"
          onPress={handleSaveMlApiUrl}
          className="mt-3 items-center rounded-xl bg-emerald-400 py-3"
        >
          <Text className="text-sm font-bold text-slate-950">Save Server URL</Text>
        </TouchableOpacity>
        <Text className="mt-2 text-[11px] text-slate-500">
          {mlApiBaseUrl ? `Configured: ${mlApiBaseUrl}` : 'Not configured'}
        </Text>
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