import { Directory, File, Paths } from "expo-file-system";

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

  const directory = new Directory(Paths.document, "LegendStream", "Downloads");
  directory.create({ idempotent: true, intermediates: true });

  const extension = extensionFromUrl(url);
  const name = `${sanitize(title)}.${extension}`;
  const destination = new File(directory, name);

  const file = await File.downloadFileAsync(url, destination, {
    idempotent: true,
    headers: {
      Accept: "*/*",
      "User-Agent": "ExoPlayer/LegendStream-XPlayer",
    },
  } as any);

  return { uri: file.uri, name, size: file.size };
}
