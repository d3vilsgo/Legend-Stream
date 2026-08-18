import AsyncStorage from "@react-native-async-storage/async-storage";
import React, {
  createContext,
  ReactNode,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  Channel,
  EpgProgram,
  loadEpg,
  loadProvider,
  Provider,
  ProviderForm,
  ProviderType,
} from "@/lib/iptv";

export { ProviderType };
export type { Channel, EpgProgram };

export interface ProviderConfig {
  id: string;
  name: string;
  type: ProviderType;
  playlistUrl: string;
  url: string;
  username?: string;
  password?: string;
  mac?: string;
  epgUrl?: string;
  connectedAt: string;
  createdAt: number;
  lastLoadedAt?: number;
  channelCount?: number;
  loadError?: string;
}

interface PlayerState {
  providers: ProviderConfig[];
  provider: ProviderConfig | null;
  channels: Channel[];
  epg: EpgProgram[];
  favorites: string[];
  history: string[];
  activeProviderId?: string;
}

interface PlayerContextValue extends PlayerState {
  isHydrating: boolean;
  isSaving: boolean;
  isLoading: boolean;
  error: string | null;
  connectProvider: (
    config: Omit<
      ProviderConfig,
      "id" | "connectedAt" | "createdAt" | "url" | "channelCount"
    > & { url?: string; epgUrl?: string; mac?: string },
  ) => Promise<boolean>;
  removeProvider: (providerId?: string) => Promise<void>;
  refreshProvider: (providerId?: string) => Promise<void>;
  refreshEpg: (providerId?: string) => Promise<void>;
  setActiveProvider: (providerId: string) => Promise<void>;
  toggleFavorite: (channelId: string) => Promise<void>;
  recordWatched: (channelId: string) => Promise<void>;
  clearError: () => void;
}

const STORAGE_KEY = "@legendstream/player-state-v2";
const PlayerContext = createContext<PlayerContextValue | null>(null);

const emptyState: PlayerState = {
  providers: [],
  provider: null,
  channels: [],
  epg: [],
  favorites: [],
  history: [],
};

const toProvider = (provider: Provider): ProviderConfig => ({
  ...provider,
  playlistUrl: provider.url,
  connectedAt: new Date(provider.createdAt).toISOString(),
});

const fromProvider = (provider: ProviderConfig): Provider => ({
  id: provider.id,
  name: provider.name,
  type: provider.type,
  url: provider.url || provider.playlistUrl,
  username: provider.username,
  password: provider.password,
  mac: provider.mac,
  epgUrl: provider.epgUrl,
  createdAt: provider.createdAt,
  lastLoadedAt: provider.lastLoadedAt,
  channelCount: provider.channelCount,
  loadError: provider.loadError,
});

const readState = async (): Promise<PlayerState> => {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  if (!raw) return emptyState;
  try {
    const saved = JSON.parse(raw) as Partial<PlayerState>;
    const providers = (saved.providers ?? []).map((item) => ({
      ...item,
      url: item.url || item.playlistUrl,
      playlistUrl: item.playlistUrl || item.url,
    })) as ProviderConfig[];
    return {
      // Channels and EPG are runtime data. Never rehydrate or persist them
      // through AsyncStorage; providers are refreshed when requested.
      providers,
      channels: [],
      epg: [],
      favorites: Array.isArray(saved.favorites)
        ? saved.favorites.slice(0, 500)
        : [],
      history: Array.isArray(saved.history) ? saved.history.slice(0, 12) : [],
      activeProviderId: saved.activeProviderId,
      provider:
        saved.provider ??
        providers.find((item) => item.id === saved.activeProviderId) ??
        providers[0] ??
        null,
    };
  } catch {
    return emptyState;
  }
};

export function PlayerProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<PlayerState>(emptyState);
  const [isHydrating, setIsHydrating] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    readState()
      .then((saved) => {
        setState(saved);
        setIsHydrating(false);
      })
      .catch(() => setIsHydrating(false));
  }, []);

  const persist = async (next: PlayerState) => {
    setState(next);
    const persisted = {
      providers: next.providers,
      provider: next.provider,
      activeProviderId: next.activeProviderId,
      favorites: next.favorites.slice(0, 500),
      history: next.history.slice(0, 12),
    };
    const serialized = JSON.stringify(persisted);
    try {
      await AsyncStorage.setItem(STORAGE_KEY, serialized);
    } catch {
      // A previous app version may have filled web localStorage with channel
      // data. Replace that oversized snapshot with the compact one. Storage
      // failures must never prevent the in-memory login or playback flow.
      try {
        await AsyncStorage.removeItem(STORAGE_KEY);
        await AsyncStorage.setItem(STORAGE_KEY, serialized);
      } catch {
        // Persistence is best-effort; the current session remains usable.
      }
    }
  };

  const connectProvider = async (
    config: Omit<
      ProviderConfig,
      "id" | "connectedAt" | "createdAt" | "url" | "channelCount"
    > & { url?: string; epgUrl?: string; mac?: string },
  ) => {
    setIsLoading(true);
    setError(null);
    const provider: Provider = {
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      name: config.name.trim() || "My provider",
      type: config.type,
      url: (config.url || config.playlistUrl).trim(),
      username: config.username?.trim() || undefined,
      password: config.password || undefined,
      mac: config.mac?.trim() || undefined,
      epgUrl: config.epgUrl?.trim() || undefined,
      createdAt: Date.now(),
    };

    try {
      const loaded = await loadProvider(provider);
      const savedProvider = toProvider({
        ...provider,
        lastLoadedAt: Date.now(),
        channelCount: loaded.channels.length,
        epgUrl: provider.epgUrl || loaded.epgUrl,
      });
      const next: PlayerState = {
        ...state,
        providers: [...state.providers, savedProvider],
        provider: savedProvider,
        activeProviderId: savedProvider.id,
        channels: [...state.channels, ...loaded.channels],
      };
      await persist(next);
      return true;
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "The provider could not be loaded.",
      );
      return false;
    } finally {
      setIsLoading(false);
    }
  };

  const refreshProvider = async (providerId = state.provider?.id) => {
    if (!providerId) return;
    const existing = state.providers.find((item) => item.id === providerId);
    if (!existing) return;
    setIsLoading(true);
    setError(null);
    try {
      const loaded = await loadProvider(fromProvider(existing));
      const updated = {
        ...existing,
        lastLoadedAt: Date.now(),
        channelCount: loaded.channels.length,
        epgUrl: existing.epgUrl || loaded.epgUrl,
        loadError: undefined,
      };
      await persist({
        ...state,
        provider: state.provider?.id === providerId ? updated : state.provider,
        providers: state.providers.map((item) =>
          item.id === providerId ? updated : item,
        ),
        channels: [
          ...state.channels.filter((channel) => channel.providerId !== providerId),
          ...loaded.channels,
        ],
      });
    } catch (caught) {
      const message =
        caught instanceof Error
          ? caught.message
          : "The provider could not be refreshed.";
      setError(message);
      await persist({
        ...state,
        providers: state.providers.map((item) =>
          item.id === providerId ? { ...item, loadError: message } : item,
        ),
      });
    } finally {
      setIsLoading(false);
    }
  };

  const removeProvider = async (providerId = state.provider?.id) => {
    if (!providerId) return;
    const providers = state.providers.filter((item) => item.id !== providerId);
    const channels = state.channels.filter(
      (channel) => channel.providerId !== providerId,
    );
    const favorites = state.favorites.filter((id) =>
      channels.some((channel) => channel.id === id),
    );
    const nextProvider = providers[0] ?? null;
    await persist({
      ...state,
      providers,
      provider: nextProvider,
      activeProviderId: nextProvider?.id,
      channels,
      favorites,
      epg: state.epg.filter((program) =>
        channels.some((channel) => channel.id === program.channelId),
      ),
    });
  };

  const setActiveProvider = async (providerId: string) => {
    const provider = state.providers.find((item) => item.id === providerId);
    if (!provider) return;
    await persist({ ...state, provider, activeProviderId: providerId });
  };

  const refreshEpg = async (providerId = state.provider?.id) => {
    if (!providerId) return;
    const provider = state.providers.find((item) => item.id === providerId);
    if (!provider) return;
    setIsLoading(true);
    setError(null);
    try {
      const providerChannels = state.channels.filter(
        (channel) => channel.providerId === providerId,
      );
      const programs = await loadEpg(fromProvider(provider), providerChannels);
      await persist({
        ...state,
        epg: [
          ...state.epg.filter(
            (program) =>
              !providerChannels.some(
                (channel) => channel.id === program.channelId,
              ),
          ),
          ...programs,
        ],
      });
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "The EPG could not be loaded.",
      );
    } finally {
      setIsLoading(false);
    }
  };

  const toggleFavorite = async (channelId: string) => {
    const favorites = state.favorites.includes(channelId)
      ? state.favorites.filter((id) => id !== channelId)
      : [...state.favorites, channelId];
    await persist({ ...state, favorites });
  };

  const recordWatched = async (channelId: string) =>
    persist({
      ...state,
      history: [channelId, ...state.history.filter((id) => id !== channelId)].slice(
        0,
        12,
      ),
    });

  const value = useMemo<PlayerContextValue>(
    () => ({
      ...state,
      isHydrating,
      isSaving: isLoading,
      isLoading,
      error,
      connectProvider,
      removeProvider,
      refreshProvider,
      refreshEpg,
      setActiveProvider,
      toggleFavorite,
      recordWatched,
      clearError: () => setError(null),
    }),
    [state, isHydrating, isLoading, error],
  );

  return (
    <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>
  );
}

export function usePlayer() {
  const context = useContext(PlayerContext);
  if (!context) throw new Error("usePlayer must be used within PlayerProvider");
  return context;
}