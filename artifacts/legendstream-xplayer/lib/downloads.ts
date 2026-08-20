import * as FileSystem from "expo-file-system/legacy";

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

export type DownloadResult = {
  uri: string;
  name: string;
  size?: number | null;
};

const headersToTry: Record<string, string>[] = [
  {
    Accept: "*/*",
    "User-Agent": "ExoPlayer/LegendStream-XPlayer",
  },
  {
    Accept: "*/*",
    "User-Agent": "VLC/3.0.21 LibVLC/3.0.21",
  },
  {
    Accept: "*/*",
  },
];

export async function downloadMedia(url: string, title: string): Promise<DownloadResult> {
  if (/\.m3u8(?:$|\?)/i.test(url)) {
    throw new Error("HLS_PLAYLIST_DOWNLOAD_UNSUPPORTED");
  }

  if (!FileSystem.documentDirectory) {
    throw new Error("DOWNLOAD_DIRECTORY_UNAVAILABLE");
  }

  // Android app-private document storage does NOT require broad storage
  // permission. This keeps downloads compatible with scoped storage on
  // Android 10+ and avoids requesting unnecessary READ/WRITE permissions.
  const directory = `${FileSystem.documentDirectory}LegendStream/Downloads/`;
  await FileSystem.makeDirectoryAsync(directory, { intermediates: true });

  const extension = extensionFromUrl(url);
  const name = `${sanitize(title)}.${extension}`;
  const destination = `${directory}${sanitize(title)}-${Date.now()}.${extension}`;

  let lastStatus: number | null = null;
  let lastError: unknown = null;

  for (const headers of headersToTry) {
    try {
      const existing = await FileSystem.getInfoAsync(destination);
      if (existing.exists) {
        await FileSystem.deleteAsync(destination, { idempotent: true });
      }

      const resumable = FileSystem.createDownloadResumable(
        url,
        destination,
        { headers },
      );
      const result = await resumable.downloadAsync();
      if (!result) throw new Error("DOWNLOAD_NO_RESPONSE");

      lastStatus = result.status;
      if (result.status < 200 || result.status >= 300) {
        await FileSystem.deleteAsync(destination, { idempotent: true }).catch(() => undefined);
        continue;
      }

      const info = await FileSystem.getInfoAsync(result.uri, { size: true });
      if (!info.exists || !info.size) {
        await FileSystem.deleteAsync(result.uri, { idempotent: true }).catch(() => undefined);
        throw new Error("DOWNLOAD_EMPTY_FILE");
      }

      return { uri: result.uri, name, size: info.size };
    } catch (error) {
      lastError = error;
    }
  }

  if (lastStatus) throw new Error(`DOWNLOAD_HTTP_${lastStatus}`);
  if (lastError instanceof Error) throw lastError;
  throw new Error("DOWNLOAD_FAILED");
}
