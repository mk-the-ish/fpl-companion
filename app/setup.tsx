import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { useUserStore } from '../stores/useUserStore';

export default function SetupScreen() {
  const [entryId, setEntryId] = useState('');
  const [loading, setLoading] = useState(false);
  const setTeamId = useUserStore((state) => state.setTeamId);
  const router = useRouter();

  const handleConnect = async () => {
    const parsedId = parseInt(entryId.trim(), 10);
    if (isNaN(parsedId) || parsedId <= 0) {
      Alert.alert('Invalid ID', 'Please enter a valid numeric FPL Entry/Team ID.');
      return;
    }

    setLoading(true);
    try {
      // Validate that the entry actually exists on the official FPL servers
      const res = await fetch(`https://fantasy.premierleague.com/api/entry/${parsedId}/`);
      if (!res.ok) {
        throw new Error('Team ID not found. Check your FPL team URL.');
      }
      const data = await res.json();

      setTeamId(parsedId);
      Alert.alert('Connected!', `Welcome, ${data.name} (${data.player_first_name} ${data.player_last_name})`);
      router.replace('/(tabs)');
    } catch (err: any) {
      Alert.alert('Verification Failed', err.message || 'Could not verify FPL ID.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <View className="flex-1 justify-center bg-slate-900 px-6">
      <View className="rounded-2xl border border-slate-800 bg-slate-800/80 p-6 shadow-xl">
        <Text className="text-2xl font-black tracking-tight text-emerald-400">
          Sync Your FPL Squad
        </Text>
        <Text className="mt-2 text-sm leading-relaxed text-slate-400">
          Enter your official FPL Team ID (found in the URL when viewing your points on the FPL website, e.g., entry/123456/event/...).
        </Text>

        <TextInput
          className="mt-6 rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-lg font-semibold text-white"
          placeholder="e.g. 1045231"
          placeholderTextColor="#64748b"
          keyboardType="numeric"
          value={entryId}
          onChangeText={setEntryId}
        />

        <TouchableOpacity
          className={`mt-4 items-center justify-center rounded-xl py-3.5 ${
            loading ? 'bg-emerald-600' : 'bg-emerald-400'
          }`}
          onPress={handleConnect}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#0f172a" />
          ) : (
            <Text className="text-base font-bold text-slate-950">Confirm & Load Squad</Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}