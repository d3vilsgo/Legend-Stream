import AsyncStorage from "@react-native-async-storage/async-storage";
import * as FileSystem from "expo-file-system/legacy";

const INDEX_KEY = "@legendstream/downloads-v1";

const sanitize = (value: string) => value
  .replace(/[\\/:*?"<>|\u0000-\u001F]/g, "_")
  .replace(/\s+/g, " ")
  .trim()
  .slice(0, 120) || "video";

const extensionFromUrl = (url: string) => {
  try {
    const pathname = new URL(url).pathname;
    const match = pathname.match(/\.([a-zA-Z0-9]{2,5})$/);
    if (match) return match[1].toLowerCase();
  } catch {
    // fall through
  }
  return "mp4";
};

export type DownloadedMedia = {
  id: string;
  uri: string;
  name: string;
  title: string;
  subtitle?: string;
  kind: "movie" | "episode";
  providerId?: string;
  sourceUrl: string;
  size?: number | null;
  createdAt: number;
};

export type ActiveDownload = {
  id: string;
  title: string;
  subtitle?: string;
  kind: "movie" | "episode";
  sourceUrl: string;
  progress: number;
  bytesWritten: number;
  bytesExpected: number;
  status: "downloading" | "retrying" | "failed";
  error?: string;
  startedAt: number;
};

type ActiveListener = (items: ActiveDownload[]) => void;
const activeDownloads = new Map<string, ActiveDownload>();
const activeListeners = new Set<ActiveListener>();

const emitActive = () => {
  const items = Array.from(activeDownloads.values()).sort((a, b) => b.startedAt - a.startedAt);
  activeListeners.forEach((listener) => listener(items));
};

export function getActiveDownloads(): ActiveDownload[] {
  return Array.from(activeDownloads.values()).sort((a, b) => b.startedAt - a.startedAt);
}

export function subscribeActiveDownloads(listener: ActiveListener) {
  activeListeners.add(listener);
  listener(getActiveDownloads());
  return () => activeListeners.delete(listener);
}

const setActive = (id: string, patch: Partial<ActiveDownload>) => {
  const current = activeDownloads.get(id);
  if (!current) return;
  activeDownloads.set(id, { ...current, ...patch });
  emitActive();
};

const headersToTry: Record<string, string>[] = [
  { Accept: "*/*", "User-Agent": "ExoPlayer/LegendStream-XPlayer" },
  { Accept: "*/*", "User-Agent": "VLC/3.0.21 LibVLC/3.0.21" },
  { Accept: "*/*" },
];

const readIndex = async (): Promise<DownloadedMedia[]> => {
  try {
    const raw = await AsyncStorage.getItem(INDEX_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const writeIndex = async (items: DownloadedMedia[]) => {
  await AsyncStorage.setItem(INDEX_KEY, JSON.stringify(items.slice(0, 200)));
};

export async function listDownloads(): Promise<DownloadedMedia[]> {
  const items = await readIndex();
  const valid: DownloadedMedia[] = [];
  for (const item of items) {
    try {
      const info = await FileSystem.getInfoAsync(item.uri, { size: true });
      if (info.exists) valid.push({ ...item, size: "size" in info ? info.size : item.size });
    } catch {
      // Missing files are pruned from the manifest.
    }
  }
  if (valid.length !== items.length) await writeIndex(valid).catch(() => undefined);
  return valid.sort((a, b) => b.createdAt - a.createdAt);
}

export async function deleteDownload(id: string): Promise<void> {
  const items = await readIndex();
  const target = items.find((item) => item.id === id);
  if (target) await FileSystem.deleteAsync(target.uri, { idempotent: true }).catch(() => undefined);
  await writeIndex(items.filter((item) => item.id !== id));
}

export async function clearDownloads(): Promise<void> {
  const items = await readIndex();
  await Promise.all(items.map((item) => FileSystem.deleteAsync(item.uri, { idempotent: true }).catch(() => undefined)));
  await writeIndex([]);
}

export async function downloadMedia(
  url: string,
  title: string,
  meta: {
    subtitle?: string;
    kind?: "movie" | "episode";
    providerId?: string;
    onProgress?: (progress: number, bytesWritten: number, bytesExpected: number) => void;
  } = {},
): Promise<DownloadedMedia> {
  if (/\.m3u8(?:$|\?)/i.test(url)) throw new Error("HLS_PLAYLIST_DOWNLOAD_UNSUPPORTED");
  if (!FileSystem.documentDirectory) throw new Error("DOWNLOAD_DIRECTORY_UNAVAILABLE");

  const directory = `${FileSystem.documentDirectory}LegendStream/Downloads/`;
  await FileSystem.makeDirectoryAsync(directory, { intermediates: true });

  const extension = extensionFromUrl(url);
  const name = `${sanitize(title)}.${extension}`;
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const destination = `${directory}${unique}-${sanitize(title)}.${extension}`;
  const kind = meta.kind ?? "movie";

  activeDownloads.set(unique, {
    id: unique,
    title,
    subtitle: meta.subtitle,
    kind,
    sourceUrl: url,
    progress: 0,
    bytesWritten: 0,
    bytesExpected: 0,
    status: "downloading",
    startedAt: Date.now(),
  });
  emitActive();

  let lastStatus: number | null = null;
  let lastError: unknown = null;

  for (let attempt = 0; attempt < headersToTry.length; attempt += 1) {
    const headers = headersToTry[attempt];
    try {
      if (attempt > 0) setActive(unique, { status: "retrying", progress: 0, bytesWritten: 0, bytesExpected: 0 });
      await FileSystem.deleteAsync(destination, { idempotent: true }).catch(() => undefined);
      const resumable = FileSystem.createDownloadResumable(
        url,
        destination,
        { headers },
        (data) => {
          const expected = Number(data.totalBytesExpectedToWrite || 0);
          const written = Number(data.totalBytesWritten || 0);
          const progress = expected > 0 ? Math.max(0, Math.min(1, written / expected)) : 0;
          setActive(unique, { status: "downloading", progress, bytesWritten: written, bytesExpected: expected });
          meta.onProgress?.(progress, written, expected);
        },
      );
      const result = await resumable.downloadAsync();
      if (!result) throw new Error("DOWNLOAD_NO_RESPONSE");
      lastStatus = result.status;
      if (result.status < 200 || result.status >= 300) continue;

      const info = await FileSystem.getInfoAsync(result.uri, { size: true });
      if (!info.exists || !info.size) throw new Error("DOWNLOAD_EMPTY_FILE");

      const item: DownloadedMedia = {
        id: unique,
        uri: result.uri,
        name,
        title,
        subtitle: meta.subtitle,
        kind,
        providerId: meta.providerId,
        sourceUrl: url,
        size: info.size,
        createdAt: Date.now(),
      };
      const current = await readIndex();
      await writeIndex([item, ...current.filter((existing) => existing.sourceUrl !== url)]);
      activeDownloads.delete(unique);
      emitActive();
      meta.onProgress?.(1, info.size, info.size);
      return item;
    } catch (error) {
      lastError = error;
    }
  }

  await FileSystem.deleteAsync(destination, { idempotent: true }).catch(() => undefined);
  const message = lastStatus
    ? `DOWNLOAD_HTTP_${lastStatus}`
    : lastError instanceof Error
      ? lastError.message
      : "DOWNLOAD_FAILED";
  setActive(unique, { status: "failed", error: message });
  setTimeout(() => {
    activeDownloads.delete(unique);
    emitActive();
  }, 15_000);
  throw new Error(message);
}
