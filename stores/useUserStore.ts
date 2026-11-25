import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

interface UserState {
  teamId: number | null;
  favouriteLeagueId: number | null;
  mlApiBaseUrl: string;
  setTeamId: (id: number) => void;
  setFavouriteLeagueId: (id: number) => void;
  setMlApiBaseUrl: (url: string) => void;
}

export const useUserStore = create<UserState>()(
  persist(
    (set) => ({
      teamId: null,
      favouriteLeagueId: null,
      mlApiBaseUrl: '',
      setTeamId: (id) => set({ teamId: id }),
      setFavouriteLeagueId: (id) => set({ favouriteLeagueId: id }),
      setMlApiBaseUrl: (mlApiBaseUrl) => set({ mlApiBaseUrl }),
    }),
    {
      name: 'fpl-user-storage',
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);