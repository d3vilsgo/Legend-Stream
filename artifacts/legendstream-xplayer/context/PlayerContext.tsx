import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { createContext, ReactNode, useContext, useEffect, useMemo, useState } from "react";
import {
  Channel,
  EpgProgram,
  loadEpg,
  loadProvider,
  Provider,
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

interface ProviderInput extends Omit<
  ProviderConfig,
  "id" | "connectedAt" | "createdAt" | "url" | "channelCount"
> {
  url?: string;
  epgUrl?: string;
  mac?: string;
}

interface PlayerContextValue extends PlayerState {
  isHydrating: boolean;
  isSaving: boolean;
  isLoading: boolean;
  error: string | null;
  connectProvider: (config: ProviderInput) => Promise<boolean>;
  removeProvider: (providerId?: string) => Promise<void>;
  disconnectProvider: () => Promise<void>;
  refreshProvider: (providerId?: string) => Promise<void>;
  refreshEpg: (providerId?: string) => Promise<void>;
  setActiveProvider: (providerId: string) => Promise<boolean>;
  toggleFavorite: (channelId: string) => Promise<void>;
  recordWatched: (channelId: string) => Promise<void>;
  clearError: () => void;
}

const STORAGE_KEY = "@legendstream/player-state-v3";
const LEGACY_STORAGE_KEY = "@legendstream/player-state-v2";
const LOGGED_OUT = "__logged_out__";
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

const normalizeUrl = (value: string) => value.trim().replace(/\/+$/, "").toLowerCase();

const sameAccount = (a: ProviderConfig, b: Provider) =>
  a.type === b.type &&
  normalizeUrl(a.url || a.playlistUrl) === normalizeUrl(b.url) &&
  (a.username || "") === (b.username || "") &&
  (a.mac || "").toLowerCase() === (b.mac || "").toLowerCase();

const readState = async (): Promise<PlayerState> => {
  let raw = await AsyncStorage.getItem(STORAGE_KEY);
  if (!raw) {
    raw = await AsyncStorage.getItem(LEGACY_STORAGE_KEY);
    if (raw) {
      try { await AsyncStorage.setItem(STORAGE_KEY, raw); } catch { /* best-effort migration */ }
    }
  }
  if (!raw) return emptyState;
  try {
    const saved = JSON.parse(raw) as Partial<PlayerState>;
    const providers = (saved.providers ?? []).map((item) => ({
      ...item,
      url: item.url || item.playlistUrl,
      playlistUrl: item.playlistUrl || item.url,
    })) as ProviderConfig[];
    const activeProviderId = saved.activeProviderId;
    const provider =
      activeProviderId === LOGGED_OUT
        ? null
        : providers.find((item) => item.id === activeProviderId) ??
          (saved.provider
            ? providers.find((item) => item.id === saved.provider?.id) ?? null
            : providers[0] ?? null);
    return {
      providers,
      provider,
      channels: [],
      epg: [],
      favorites: Array.isArray(saved.favorites) ? saved.favorites.slice(0, 500) : [],
      history: Array.isArray(saved.history) ? saved.history.slice(0, 50) : [],
      activeProviderId: activeProviderId ?? provider?.id,
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
      history: next.history.slice(0, 50),
    };
    try {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(persisted));
    } catch {
      // Storage is best-effort; keep the in-memory session usable.
    }
  };

  const connectProvider = async (config: ProviderInput) => {
    setIsLoading(true);
    setError(null);
    const candidate: Provider = {
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
      const duplicate = state.providers.find((item) => sameAccount(item, candidate));
      const providerToLoad = duplicate
        ? { ...candidate, id: duplicate.id, createdAt: duplicate.createdAt }
        : candidate;
      const loaded = await loadProvider(providerToLoad);
      const savedProvider = toProvider({
        ...providerToLoad,
        lastLoadedAt: Date.now(),
        channelCount: loaded.channels.length,
        epgUrl: providerToLoad.epgUrl || loaded.epgUrl,
      });
      const providers = duplicate
        ? state.providers.map((item) => (item.id === duplicate.id ? savedProvider : item))
        : [...state.providers, savedProvider];
      await persist({
        ...state,
        providers,
        provider: savedProvider,
        activeProviderId: savedProvider.id,
        channels: [
          ...state.channels.filter((channel) => channel.providerId !== savedProvider.id),
          ...loaded.channels,
        ],
      });
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The provider could not be loaded.");
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
      const updated: ProviderConfig = {
        ...existing,
        lastLoadedAt: Date.now(),
        channelCount: loaded.channels.length,
        epgUrl: existing.epgUrl || loaded.epgUrl,
        loadError: undefined,
      };
      await persist({
        ...state,
        provider: state.provider?.id === providerId ? updated : state.provider,
        providers: state.providers.map((item) => (item.id === providerId ? updated : item)),
        channels: [
          ...state.channels.filter((channel) => channel.providerId !== providerId),
          ...loaded.channels,
        ],
      });
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "The provider could not be refreshed.";
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

  const setActiveProvider = async (providerId: string) => {
    const existing = state.providers.find((item) => item.id === providerId);
    if (!existing) return false;
    setIsLoading(true);
    setError(null);
    try {
      const alreadyLoaded = state.channels.some((channel) => channel.providerId === providerId);
      if (alreadyLoaded) {
        await persist({ ...state, provider: existing, activeProviderId: providerId });
        return true;
      }
      const loaded = await loadProvider(fromProvider(existing));
      const updated: ProviderConfig = {
        ...existing,
        lastLoadedAt: Date.now(),
        channelCount: loaded.channels.length,
        epgUrl: existing.epgUrl || loaded.epgUrl,
        loadError: undefined,
      };
      await persist({
        ...state,
        provider: updated,
        activeProviderId: providerId,
        providers: state.providers.map((item) => (item.id === providerId ? updated : item)),
        channels: [
          ...state.channels.filter((channel) => channel.providerId !== providerId),
          ...loaded.channels,
        ],
      });
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The saved provider could not be opened.");
      return false;
    } finally {
      setIsLoading(false);
    }
  };

  const disconnectProvider = async () => {
    await persist({ ...state, provider: null, activeProviderId: LOGGED_OUT });
  };

  const removeProvider = async (providerId = state.provider?.id) => {
    if (!providerId) return;
    const providers = state.providers.filter((item) => item.id !== providerId);
    const channels = state.channels.filter((channel) => channel.providerId !== providerId);
    const favorites = state.favorites.filter((id) => channels.some((channel) => channel.id === id));
    const history = state.history.filter((id) => channels.some((channel) => channel.id === id));
    const nextProvider = state.provider?.id === providerId ? providers[0] ?? null : state.provider;
    await persist({
      ...state,
      providers,
      provider: nextProvider,
      activeProviderId: nextProvider?.id ?? (providers.length ? providers[0].id : LOGGED_OUT),
      channels,
      favorites,
      history,
      epg: state.epg.filter((program) => channels.some((channel) => channel.id === program.channelId)),
    });
  };

  const refreshEpg = async (providerId = state.provider?.id) => {
    if (!providerId) return;
    const provider = state.providers.find((item) => item.id === providerId);
    if (!provider) return;
    setIsLoading(true);
    setError(null);
    try {
      const providerChannels = state.channels.filter((channel) => channel.providerId === providerId);
      const programs = await loadEpg(fromProvider(provider), providerChannels);
      await persist({
        ...state,
        epg: [
          ...state.epg.filter(
            (program) => !providerChannels.some((channel) => channel.id === program.channelId),
          ),
          ...programs,
        ],
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The EPG could not be loaded.");
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
      history: [channelId, ...state.history.filter((id) => id !== channelId)].slice(0, 50),
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
      disconnectProvider,
      refreshProvider,
      refreshEpg,
      setActiveProvider,
      toggleFavorite,
      recordWatched,
      clearError: () => setError(null),
    }),
    [state, isHydrating, isLoading, error],
  );

  return <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>;
}

export function usePlayer() {
  const context = useContext(PlayerContext);
  if (!context) throw new Error("usePlayer must be used within PlayerProvider");
  return context;
}
