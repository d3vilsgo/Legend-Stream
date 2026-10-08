import type { Channel, EpgProgram } from "./iptv";
import { traceStalker } from "./stalkerPlaybackTrace";
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

export type StalkerProductEpgResult = {
  programs: EpgProgram[];
  diagnostics: StalkerProductEpgDiagnostics;
};

export type StalkerProductEpgDiagnostics = {
  request: "SUCCESS" | "FAILURE" | "TIMEOUT";
  knownChannels: number;
  responseGroups: number;
  matchedGroups: number;
  validRows: number;
  expiredRows: number;
  futureOrCurrentRows: number;
  publishedPrograms: number;
  channelsWithPrograms: number;
  result: "SUCCESS" | "EMPTY" | "FAILURE" | "TIMEOUT";
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

const emptyDiagnostics = (request: StalkerProductEpgDiagnostics["request"], knownChannels = 0): StalkerProductEpgDiagnostics => ({
  request,
  knownChannels,
  responseGroups: 0,
  matchedGroups: 0,
  validRows: 0,
  expiredRows: 0,
  futureOrCurrentRows: 0,
  publishedPrograms: 0,
  channelsWithPrograms: 0,
  result: request === "SUCCESS" ? "EMPTY" : request,
});

function traceProductEpg(diagnostics: StalkerProductEpgDiagnostics) {
  traceStalker("STALKER_PRODUCT_EPG", diagnostics);
}

export function normalizeStalkerProductEpgDetailed(
  payload: unknown,
  providerId: string,
  channels: readonly Pick<Channel, "id" | "providerId">[],
  nowMs = Date.now(),
): StalkerProductEpgResult {
  const knownIds = new Set(
    channels
      .filter((channel) => channel.providerId === providerId)
      .map((channel) => channel.id),
  );
  const groups = groupedPayload(payload);
  const programmes: EpgProgram[] = [];
  const exactSeen = new Set<string>();
  const channelsWithPrograms = new Set<string>();
  const diagnostics = emptyDiagnostics("SUCCESS", knownIds.size);
  diagnostics.responseGroups = Object.entries(groups).filter(([, rawRows]) => Array.isArray(rawRows)).length;

  for (const [groupKey, rawRows] of Object.entries(groups)) {
    if (!groupKey.trim() || !Array.isArray(rawRows)) continue;
    let channelId: string;
    try {
      channelId = stableStalkerLiveChannelId(providerId, groupKey);
    } catch {
      continue;
    }
    if (!knownIds.has(channelId)) continue;
    diagnostics.matchedGroups += 1;

    const channelPrograms: EpgProgram[] = [];
    for (const rawRow of rawRows) {
      const row = object(rawRow);
      if (!row) continue;
      const start = epochMs(row.start_timestamp);
      const end = epochMs(row.stop_timestamp);
      if (start === null || end === null || end <= start) continue;
      diagnostics.validRows += 1;
      if (end <= nowMs) {
        diagnostics.expiredRows += 1;
        continue;
      }
      diagnostics.futureOrCurrentRows += 1;
      const title = text(row.name).trim() || "Untitled program";
      const description = text(row.descr).trim() || undefined;
      const duplicateKey = [channelId, start, end, title, description ?? ""].join("\u0000");
      if (exactSeen.has(duplicateKey)) continue;
      exactSeen.add(duplicateKey);
      channelPrograms.push({
        id: `${channelId}:${start}:${title}`,
        channelId,
        title,
        description,
        start,
        end,
      });
    }
    channelPrograms.sort((a, b) =>
      a.start - b.start ||
      a.end - b.end ||
      a.title.localeCompare(b.title),
    );
    const retained = channelPrograms.slice(0, MAX_PROGRAMMES_PER_CHANNEL);
    if (retained.length) channelsWithPrograms.add(channelId);
    programmes.push(...retained);
  }

  programmes.sort((a, b) =>
    a.start - b.start ||
    a.end - b.end ||
    a.channelId.localeCompare(b.channelId),
  );
  diagnostics.publishedPrograms = programmes.length;
  diagnostics.channelsWithPrograms = channelsWithPrograms.size;
  diagnostics.result = programmes.length > 0 ? "SUCCESS" : "EMPTY";
  return { programs: programmes, diagnostics };
}

export function normalizeStalkerProductEpg(
  payload: unknown,
  providerId: string,
  channels: readonly Pick<Channel, "id" | "providerId">[],
  nowMs = Date.now(),
): EpgProgram[] {
  return normalizeStalkerProductEpgDetailed(payload, providerId, channels, nowMs).programs;
}

export async function loadStalkerProductEpg(
  provider: StalkerEpgProvider,
  channels: readonly Channel[],
  signal?: AbortSignal,
  acquireSession = getOrCreateStalkerPortalSession,
): Promise<EpgProgram[]> {
  if (signal?.aborted) {
    const diagnostics = emptyDiagnostics("TIMEOUT", channels.filter((channel) => channel.providerId === provider.id).length);
    traceProductEpg(diagnostics);
    return [];
  }
  try {
    const session = acquireSession({
      providerId: provider.id,
      portalUrl: provider.url,
      mac: provider.mac ?? "",
    });
    const payload = await session.request(
      { type: "itv", action: "get_epg_info" },
      signal,
    );
    if (signal?.aborted) {
      const diagnostics = emptyDiagnostics("TIMEOUT", channels.filter((channel) => channel.providerId === provider.id).length);
      traceProductEpg(diagnostics);
      return [];
    }
    const result = normalizeStalkerProductEpgDetailed(payload, provider.id, channels);
    traceProductEpg(result.diagnostics);
    return result.programs;
  } catch (caught) {
    const diagnostics = emptyDiagnostics(signal?.aborted ? "TIMEOUT" : "FAILURE", channels.filter((channel) => channel.providerId === provider.id).length);
    traceProductEpg(diagnostics);
    throw caught;
  }
}
