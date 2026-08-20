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

export async function downloadMedia(url: string, title: string): Promise<DownloadResult> {
  if (/\.m3u8(?:$|\?)/i.test(url)) {
    throw new Error("HLS_PLAYLIST_DOWNLOAD_UNSUPPORTED");
  }

  if (!FileSystem.documentDirectory) {
    throw new Error("DOWNLOAD_DIRECTORY_UNAVAILABLE");
  }

  const directory = `${FileSystem.documentDirectory}LegendStream/Downloads/`;
  await FileSystem.makeDirectoryAsync(directory, { intermediates: true }).catch(() => undefined);

  const extension = extensionFromUrl(url);
  const name = `${sanitize(title)}.${extension}`;
  const destination = `${directory}${encodeURIComponent(name).replace(/%2F/gi, "_")}`;

  // Remove a partial/old file before retrying the same title.
  const existing = await FileSystem.getInfoAsync(destination);
  if (existing.exists) {
    await FileSystem.deleteAsync(destination, { idempotent: true });
  }

  const result = await FileSystem.downloadAsync(url, destination, {
    headers: {
      Accept: "*/*",
      "User-Agent": "ExoPlayer/LegendStream-XPlayer",
    },
  });

  if (result.status < 200 || result.status >= 300) {
    await FileSystem.deleteAsync(destination, { idempotent: true }).catch(() => undefined);
    throw new Error(`DOWNLOAD_HTTP_${result.status}`);
  }

  const info = await FileSystem.getInfoAsync(result.uri, { size: true });
  if (!info.exists || !info.size) {
    throw new Error("DOWNLOAD_EMPTY_FILE");
  }

  return { uri: result.uri, name, size: info.size };
}
