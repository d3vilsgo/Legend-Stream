export const LIVE_ID_LOOKUP_CHUNK_SIZE = 200;
export const HOME_LIVE_IDENTITY_PREVIEW_LIMIT = 14;

export function normalizeLiveIdentityIds(ids: readonly string[]) {
  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const raw of ids) {
    const id = raw.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    normalized.push(id);
  }
  return normalized;
}

export function homeLiveIdentityPreviewIds(history: readonly string[]) {
  return normalizeLiveIdentityIds(history).slice(0, HOME_LIVE_IDENTITY_PREVIEW_LIMIT);
}

export function chunkLiveIdentityIds(ids: readonly string[]) {
  const normalized = normalizeLiveIdentityIds(ids);
  const chunks: string[][] = [];
  for (let start = 0; start < normalized.length; start += LIVE_ID_LOOKUP_CHUNK_SIZE) {
    chunks.push(normalized.slice(start, start + LIVE_ID_LOOKUP_CHUNK_SIZE));
  }
  return chunks;
}
