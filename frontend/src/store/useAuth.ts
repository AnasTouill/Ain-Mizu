import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export interface AuthUser {
  user_id: string;
  email: string;
  name: string;
  role: 'farmer' | 'admin';
  language: string;
  farm_ids: string[];
}

interface AuthState {
  token: string | null;
  user: AuthUser | null;
  setAuth: (token: string, user: AuthUser) => void;
  setUser: (user: AuthUser) => void;
  logout: () => void;
}

/** JWT + profile, kept in localStorage (ARCHITECTURE.md 15, page 0). */
export const useAuth = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      user: null,
      setAuth: (token, user) => set({ token, user }),
      setUser: (user) => set({ user }),
      logout: () => set({ token: null, user: null }),
    }),
    { name: 'physarum-grid-auth', storage: createJSONStorage(() => localStorage) },
  ),
);
