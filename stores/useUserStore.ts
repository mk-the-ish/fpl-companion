import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

interface UserState {
  teamId: number | null;
  favouriteLeagueId: number | null;
  setTeamId: (id: number) => void;
  setFavouriteLeagueId: (id: number) => void;
}

export const useUserStore = create<UserState>()(
  persist(
    (set) => ({
      teamId: null,
      favouriteLeagueId: null,
      setTeamId: (id) => set({ teamId: id }),
      setFavouriteLeagueId: (id) => set({ favouriteLeagueId: id }),
    }),
    {
      name: 'fpl-user-storage',
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);