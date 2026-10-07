import type { Channel, EpgProgram } from "./iptv";
import { stableStalkerLiveChannelId } from "./stalkerLiveCatalog";
import { getOrCreateStalkerPortalSession } from "./stalkerPortalRuntime";

const MIN_EPOCH_SECONDS = 946684800; // 2000-01-01
const MAX_EPOCH_SECONDS = 4102444800; // 2100-01-01
const MAX_PROGRAMMES_PER_CHANNEL = 12;

type StalkerEpgProvider = {
  id: string;
  url: string;
  mac?: string;
};

const object = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;

const text = (value: unknown) =>
  typeof value === "string" ? value : typeof value === "number" ? String(value) : "";

function epochMs(value: unknown) {
  const seconds = typeof value === "number"
    ? value
    : typeof value === "string" && value.trim() !== ""
      ? Number(value)
      : Number.NaN;
  if (
    !Number.isFinite(seconds) ||
    seconds < MIN_EPOCH_SECONDS ||
    seconds > MAX_EPOCH_SECONDS
  ) return null;
  return Math.trunc(seconds * 1000);
}

function groupedPayload(payload: unknown) {
  const root = object(payload);
  if (!root) throw new Error("Stalker EPG bulk response has an invalid shape.");
  const nested = object(root.data);
  return nested ?? root;
}

export function normalizeStalkerProductEpg(
  payload: unknown,
  providerId: string,
  channels: readonly Pick<Channel, "id" | "providerId">[],
): EpgProgram[] {
  const knownIds = new Set(
    channels
      .filter((channel) => channel.providerId === providerId)
      .map((channel) => channel.id),
  );
  const groups = groupedPayload(payload);
  const programmes: EpgProgram[] = [];
  const exactSeen = new Set<string>();

  for (const [groupKey, rawRows] of Object.entries(groups)) {
    if (!groupKey.trim() || !Array.isArray(rawRows)) continue;
    let channelId: string;
    try {
      channelId = stableStalkerLiveChannelId(providerId, groupKey);
    } catch {
      continue;
    }
    if (!knownIds.has(channelId)) continue;

    let acceptedForChannel = 0;
    for (const rawRow of rawRows) {
      if (acceptedForChannel >= MAX_PROGRAMMES_PER_CHANNEL) break;
      const row = object(rawRow);
      if (!row) continue;
      const start = epochMs(row.start_timestamp);
      const end = epochMs(row.stop_timestamp);
      if (start === null || end === null || end <= start) continue;
      const title = text(row.name).trim() || "Untitled program";
      const description = text(row.descr).trim() || undefined;
      const duplicateKey = [channelId, start, end, title, description ?? ""].join("\u0000");
      if (exactSeen.has(duplicateKey)) continue;
      exactSeen.add(duplicateKey);
      programmes.push({
        id: `${channelId}:${start}:${title}`,
        channelId,
        title,
        description,
        start,
        end,
      });
      acceptedForChannel += 1;
    }
  }

  return programmes.sort((a, b) =>
    a.start - b.start ||
    a.end - b.end ||
    a.channelId.localeCompare(b.channelId),
  );
}

export async function loadStalkerProductEpg(
  provider: StalkerEpgProvider,
  channels: readonly Channel[],
  signal?: AbortSignal,
): Promise<EpgProgram[]> {
  if (signal?.aborted) return [];
  const session = getOrCreateStalkerPortalSession({
    providerId: provider.id,
    portalUrl: provider.url,
    mac: provider.mac ?? "",
  });
  const payload = await session.request(
    { type: "itv", action: "get_epg_info" },
    signal,
  );
  if (signal?.aborted) return [];
  return normalizeStalkerProductEpg(payload, provider.id, channels);
}
