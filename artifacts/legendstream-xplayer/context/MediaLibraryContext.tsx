import AsyncStorage from "@react-native-async-storage/async-storage";
import React, {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

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
  const entriesRef = useRef<MediaProgress[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => {
        if (!raw) return;
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          const next = parsed.slice(0, 100) as MediaProgress[];
          entriesRef.current = next;
          setEntries(next);
        }
      })
      .catch(() => undefined)
      .finally(() => setLoaded(true));
  }, []);

  const persist = useCallback(async (next: MediaProgress[]) => {
    const trimmed = next.slice(0, 100);
    entriesRef.current = trimmed;
    setEntries(trimmed);
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed)).catch(() => undefined);
  }, []);

  const getProgress = useCallback(
    (source: string) => entriesRef.current.find((item) => item.source === source),
    [],
  );

  const saveProgress = useCallback(async (entry: Omit<MediaProgress, "id" | "updatedAt">) => {
    if (!Number.isFinite(entry.position) || entry.position < 0) return;

    const current = entriesRef.current;
    const previous = current.find((item) => item.source === entry.source);
    const now = Date.now();

    // Avoid redundant AsyncStorage writes if two lifecycle events arrive together.
    if (
      previous &&
      Math.abs(previous.position - entry.position) < 1.5 &&
      Math.abs(previous.duration - entry.duration) < 1.5 &&
      now - previous.updatedAt < 8_000
    ) {
      return;
    }

    const nextEntry: MediaProgress = {
      ...entry,
      id: makeId(entry.source),
      updatedAt: now,
    };
    const next = [nextEntry, ...current.filter((item) => item.source !== entry.source)]
      .filter((item) => item.duration <= 0 || item.position < Math.max(0, item.duration - 30))
      .slice(0, 100);
    await persist(next);
  }, [persist]);

  const removeProgress = useCallback(
    async (source: string) => persist(entriesRef.current.filter((item) => item.source !== source)),
    [persist],
  );

  const clearProgress = useCallback(async () => persist([]), [persist]);

  const value = useMemo<MediaLibraryValue>(() => ({
    entries,
    loaded,
    getProgress,
    saveProgress,
    removeProgress,
    clearProgress,
  }), [clearProgress, entries, getProgress, loaded, removeProgress, saveProgress]);

  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useMediaLibrary() {
  const value = useContext(Context);
  if (!value) throw new Error("useMediaLibrary must be used within MediaLibraryProvider");
  return value;
}
