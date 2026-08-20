import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { createContext, ReactNode, useContext, useEffect, useMemo, useState } from "react";

export type MediaKind = "movie" | "episode";
export type MediaProgress = {
  id: string;
  kind: MediaKind;
  title: string;
  subtitle?: string;
  source: string;
  position: number;
  duration: number;
  updatedAt: number;
};

type MediaLibraryValue = {
  entries: MediaProgress[];
  loaded: boolean;
  getProgress: (source: string) => MediaProgress | undefined;
  saveProgress: (entry: Omit<MediaProgress, "id" | "updatedAt">) => Promise<void>;
  removeProgress: (source: string) => Promise<void>;
  clearProgress: () => Promise<void>;
};

const STORAGE_KEY = "@legendstream/media-progress-v1";
const Context = createContext<MediaLibraryValue | null>(null);
const makeId = (source: string) => `media-${Math.abs([...source].reduce((n, c) => ((n << 5) - n + c.charCodeAt(0)) | 0, 0))}`;

export function MediaLibraryProvider({ children }: { children: ReactNode }) {
  const [entries, setEntries] = useState<MediaProgress[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => {
        if (!raw) return;
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) setEntries(parsed.slice(0, 100));
      })
      .catch(() => undefined)
      .finally(() => setLoaded(true));
  }, []);

  const persist = async (next: MediaProgress[]) => {
    setEntries(next);
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next.slice(0, 100))).catch(() => undefined);
  };

  const saveProgress = async (entry: Omit<MediaProgress, "id" | "updatedAt">) => {
    if (!Number.isFinite(entry.position) || entry.position < 0) return;
    const nextEntry: MediaProgress = { ...entry, id: makeId(entry.source), updatedAt: Date.now() };
    const next = [nextEntry, ...entries.filter((item) => item.source !== entry.source)]
      .filter((item) => item.duration <= 0 || item.position < Math.max(0, item.duration - 30))
      .slice(0, 100);
    await persist(next);
  };

  const removeProgress = async (source: string) => persist(entries.filter((item) => item.source !== source));
  const clearProgress = async () => persist([]);

  const value = useMemo<MediaLibraryValue>(() => ({
    entries,
    loaded,
    getProgress: (source) => entries.find((item) => item.source === source),
    saveProgress,
    removeProgress,
    clearProgress,
  }), [entries, loaded]);

  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useMediaLibrary() {
  const value = useContext(Context);
  if (!value) throw new Error("useMediaLibrary must be used within MediaLibraryProvider");
  return value;
}
