/** Metadata for the existing native owner, never a second focus controller. */
export function nativeTvRegion(id: string, fallback = "content"): string {
  if (id.startsWith("nav:")) return "navigation";
  if (/^home[-:]/.test(id)) return "home";
  if (/^live[-:]/.test(id)) return "live";
  if (/^(vod:|stalker:vod:|stalker-vod:)/.test(id)) return "movies";
  if (/^(series[-:]|season:|episode:)/.test(id)) return "series";
  return fallback;
}
