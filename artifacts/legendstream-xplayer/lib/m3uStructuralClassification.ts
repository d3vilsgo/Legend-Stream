const KNOWN_KIND_SEGMENTS = new Set(["live", "movie", "series"]);

function pathFor(streamUrl: string) {
  const lowerUrl = streamUrl.toLowerCase();
  try {
    return new URL(streamUrl).pathname.toLowerCase();
  } catch {
    return lowerUrl.split(/[?#]/, 1)[0];
  }
}

export function hasCredentialPathLiveShape(streamUrl: string) {
  const path = pathFor(streamUrl);
  const segments = path.split("/").filter(Boolean);
  if (segments.length !== 3) return false;
  if (segments.some((segment) => KNOWN_KIND_SEGMENTS.has(segment))) return false;

  const streamId = segments.at(-1) ?? "";
  const hasExtension = /\.[a-z0-9]{1,16}$/i.test(streamId);
  return !hasExtension;
}
