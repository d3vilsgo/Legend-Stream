import { redactSensitiveText, safeLog } from "./safeLog";
import type { StalkerIsolatedSession } from "./stalkerIsolatedLogin";
import { observeStalkerSeriesPayload, probeStalkerSeriesCreateLink, type StalkerSeriesCreateLinkObservation, type StalkerSeriesProbeItem, type StalkerSeriesProbeObservation } from "./stalkerSeriesProbe";

export type StalkerSeriesSensitiveFieldShape = {
  key: string;
  type: string;
  length?: number;
};

export type StalkerSeriesArrayFieldShape = {
  key: string;
  length: number;
  firstItemType?: string;
  firstItemFieldNames?: string[];
};

export type StalkerSeriesObjectFieldShape = {
  key: string;
  fieldNames: string[];
};

export type StalkerSeriesRowShape = {
  index: number;
  fieldNames: string[];
  primitiveTypes: Record<string, string>;
  safePrimitives: string[];
  arrayFields: StalkerSeriesArrayFieldShape[];
  objectFields: StalkerSeriesObjectFieldShape[];
  sensitiveFields: StalkerSeriesSensitiveFieldShape[];
};

export type StalkerSeriesRootShape = {
  fieldNames: string[];
  dataFieldType: string;
  rowsCount: number;
  totalItems?: number;
  maxPageItems?: number;
  currentPage?: number;
  objectFields: StalkerSeriesObjectFieldShape[];
};

export type StalkerSeriesEmbeddedHierarchyClassification = "EMBEDDED_HIERARCHY_FOUND" | "SEASONS_ONLY" | "EMPTY" | "UNSUPPORTED";

export type StalkerSeriesEmbeddedHierarchySeason = {
  id: string;
  label: string;
  episodeIds: string[];
  episodeCount: number;
};

export type StalkerSeriesEmbeddedHierarchy = {
  classification: StalkerSeriesEmbeddedHierarchyClassification;
  seasons: StalkerSeriesEmbeddedHierarchySeason[];
  totalSeasons: number;
  totalEmbeddedEpisodes: number;
};

export type StalkerSeriesPlaybackRef = {
  seasonId: string;
  label: string;
  hasCmd: boolean;
  cmdType: string;
  cmdLength: number;
  probe: (episodeId: string, signal?: AbortSignal) => Promise<StalkerSeriesCreateLinkObservation>;
};

export type StalkerSeriesPhysicalShapeProbe = {
  observation: StalkerSeriesProbeObservation;
  rootShape: StalkerSeriesRootShape;
  rowShapes: StalkerSeriesRowShape[];
  hierarchy: StalkerSeriesEmbeddedHierarchy;
  playbackRefs: StalkerSeriesPlaybackRef[];
};

const D4_TIMEOUT_MS = 12_000;
const D4_MAX_ROWS = 3;
const D5_MAX_SEASON_ROWS = 30;
const D5_MAX_EPISODE_IDS_PER_SEASON = 30;
const D5_MAX_TOTAL_EPISODE_IDS = 120;
const sensitiveFieldName = /(?:cmd|url|uri|token|auth|authorization|cookie|mac|password|secret|credential|user|login|stream|link)/i;
const seasonIdentityKeys = ["season_id", "season", "season_number", "season_num"] as const;

type Params = Record<string, string | number | boolean | undefined>;

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function valueType(value: unknown) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function rowsFromEnvelope(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  const root = asObject(payload);
  if (Array.isArray(root?.data)) return root.data;
  if (Array.isArray(root?.js)) return root.js;
  const nestedData = asObject(root?.data);
  if (Array.isArray(nestedData?.data)) return nestedData.data;
  if (Array.isArray(nestedData?.items)) return nestedData.items;
  return [];
}

function finiteNumber(value: unknown) {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : undefined;
}

function safeIdentifier(value: unknown): string | null {
  if (typeof value === "string") return value.trim() ? value : null;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function seasonIdentity(row: Record<string, unknown>): string | null {
  for (const key of seasonIdentityKeys) {
    const value = safeIdentifier(row[key]);
    if (value) return value;
  }
  const label = typeof row.name === "string" ? row.name : typeof row.title === "string" ? row.title : "";
  const match = /^season\s+([^\s]+)$/i.exec(label.trim());
  return match?.[1] ? match[1] : null;
}

function seasonLabel(row: Record<string, unknown>, id: string) {
  const candidate = typeof row.name === "string" && row.name.trim()
    ? row.name
    : typeof row.title === "string" && row.title.trim()
      ? row.title
      : `Season ${id}`;
  return redactSensitiveText(candidate).slice(0, 80);
}

export function extractStalkerSeriesEmbeddedHierarchy(payload: unknown): StalkerSeriesEmbeddedHierarchy {
  const rows = rowsFromEnvelope(payload).slice(0, D5_MAX_SEASON_ROWS);
  if (!rows.length) return { classification: "EMPTY", seasons: [], totalSeasons: 0, totalEmbeddedEpisodes: 0 };

  const seasons = new Map<string, { id: string; label: string; episodeIds: string[]; seen: Set<string> }>();
  let totalEmbeddedEpisodes = 0;

  for (const raw of rows) {
    const row = asObject(raw);
    if (!row) continue;
    const id = seasonIdentity(row);
    if (!id) continue;
    let season = seasons.get(id);
    if (!season) {
      season = { id, label: seasonLabel(row, id), episodeIds: [], seen: new Set<string>() };
      seasons.set(id, season);
    }

    if (!Array.isArray(row.series)) continue;
    for (const rawEpisodeId of row.series.slice(0, D5_MAX_EPISODE_IDS_PER_SEASON)) {
      if (totalEmbeddedEpisodes >= D5_MAX_TOTAL_EPISODE_IDS) break;
      const episodeId = safeIdentifier(rawEpisodeId);
      if (!episodeId || season.seen.has(episodeId)) continue;
      season.seen.add(episodeId);
      season.episodeIds.push(episodeId);
      totalEmbeddedEpisodes += 1;
    }
  }

  const safeSeasons = [...seasons.values()].map(({ id, label, episodeIds }) => ({
    id,
    label,
    episodeIds,
    episodeCount: episodeIds.length,
  }));
  if (!safeSeasons.length) return { classification: "UNSUPPORTED", seasons: [], totalSeasons: 0, totalEmbeddedEpisodes: 0 };
  return {
    classification: totalEmbeddedEpisodes > 0 ? "EMBEDDED_HIERARCHY_FOUND" : "SEASONS_ONLY",
    seasons: safeSeasons,
    totalSeasons: safeSeasons.length,
    totalEmbeddedEpisodes,
  };
}

function inspectSensitiveField(key: string, value: unknown): StalkerSeriesSensitiveFieldShape {
  const type = valueType(value);
  if (typeof value === "string") return { key, type, length: value.length };
  if (Array.isArray(value)) return { key, type, length: value.length };
  return { key, type };
}

export function inspectStalkerSeriesRowShape(row: Record<string, unknown>, index: number): StalkerSeriesRowShape {
  const primitiveTypes: Record<string, string> = {};
  const safePrimitives: string[] = [];
  const arrayFields: StalkerSeriesArrayFieldShape[] = [];
  const objectFields: StalkerSeriesObjectFieldShape[] = [];
  const sensitiveFields: StalkerSeriesSensitiveFieldShape[] = [];

  for (const key of Object.keys(row).sort()) {
    const value = row[key];
    if (sensitiveFieldName.test(key)) {
      sensitiveFields.push(inspectSensitiveField(key, value));
      continue;
    }

    if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      primitiveTypes[key] = valueType(value);
      if (value !== null) safePrimitives.push(`${key}=${redactSensitiveText(String(value)).slice(0, 120)}`);
      continue;
    }

    if (Array.isArray(value)) {
      const first = value[0];
      const firstObject = asObject(first);
      arrayFields.push({
        key,
        length: value.length,
        ...(value.length ? { firstItemType: valueType(first) } : {}),
        ...(firstObject ? { firstItemFieldNames: Object.keys(firstObject).sort().slice(0, 64) } : {}),
      });
      continue;
    }

    const nested = asObject(value);
    if (nested) objectFields.push({ key, fieldNames: Object.keys(nested).sort().slice(0, 64) });
  }

  return {
    index,
    fieldNames: Object.keys(row).sort().slice(0, 64),
    primitiveTypes,
    safePrimitives,
    arrayFields,
    objectFields,
    sensitiveFields,
  };
}

export function inspectStalkerSeriesRootShape(payload: unknown): StalkerSeriesRootShape {
  const root = asObject(payload);
  const nestedData = asObject(root?.data);
  const read = (key: string) => root?.[key] ?? nestedData?.[key];
  const objectFields: StalkerSeriesObjectFieldShape[] = [];
  if (root) {
    for (const key of Object.keys(root).sort()) {
      if (sensitiveFieldName.test(key)) continue;
      const nested = asObject(root[key]);
      if (nested) objectFields.push({ key, fieldNames: Object.keys(nested).sort().slice(0, 64) });
    }
  }
  const totalItems = finiteNumber(read("total_items") ?? read("total"));
  const maxPageItems = finiteNumber(read("max_page_items") ?? read("max_page_size"));
  const currentPage = finiteNumber(read("cur_page") ?? read("current_page") ?? read("page") ?? read("p"));
  return {
    fieldNames: root ? Object.keys(root).sort().slice(0, 64) : [],
    dataFieldType: root && Object.prototype.hasOwnProperty.call(root, "data") ? valueType(root.data) : root && Object.prototype.hasOwnProperty.call(root, "js") ? valueType(root.js) : "absent",
    rowsCount: rowsFromEnvelope(payload).length,
    ...(totalItems === undefined ? {} : { totalItems }),
    ...(maxPageItems === undefined ? {} : { maxPageItems }),
    ...(currentPage === undefined ? {} : { currentPage }),
    objectFields,
  };
}

function linkedTimeoutSignal(external?: AbortSignal) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  external?.addEventListener("abort", abort, { once: true });
  if (external?.aborted) controller.abort();
  const timer = setTimeout(abort, D4_TIMEOUT_MS);
  return {
    signal: controller.signal,
    cleanup() {
      clearTimeout(timer);
      external?.removeEventListener("abort", abort);
    },
  };
}

export async function probeStalkerSeriesPhysicalRowShape(
  session: StalkerIsolatedSession,
  item: StalkerSeriesProbeItem,
  signal?: AbortSignal,
): Promise<StalkerSeriesPhysicalShapeProbe> {
  const params: Params = { type: "series", action: "get_ordered_list", movie_id: item.id, p: 1 };
  const linked = linkedTimeoutSignal(signal);
  safeLog.info("SERIES_D4_SHAPE_REQUEST", {
    type: params.type,
    action: params.action,
    param_keys: ["movie_id", "p"],
  });
  try {
    const payload = await session.request(params, linked.signal, undefined, { providerId: "r16-d4-series-shape-probe" });
    const baseObservation = observeStalkerSeriesPayload(payload);
    const rowShapes = rowsFromEnvelope(payload)
      .slice(0, D4_MAX_ROWS)
      .map(asObject)
      .filter((row): row is Record<string, unknown> => Boolean(row))
      .map((row, index) => inspectStalkerSeriesRowShape(row, index + 1));
    const observation: StalkerSeriesProbeObservation = {
      ...baseObservation,
      classification: baseObservation.classification === "UNSUPPORTED"
        ? "UNSUPPORTED"
        : rowShapes.length > 0
          ? "SUCCESS"
          : "EMPTY",
    };
    const rootShape = inspectStalkerSeriesRootShape(payload);
    const hierarchy = extractStalkerSeriesEmbeddedHierarchy(payload);
    const playbackRefs: StalkerSeriesPlaybackRef[] = [];
    const seasonRows = rowsFromEnvelope(payload)
      .slice(0, D5_MAX_SEASON_ROWS)
      .map(asObject)
      .filter((row): row is Record<string, unknown> => Boolean(row));
    for (const season of hierarchy.seasons) {
      const row = seasonRows.find((candidate) => seasonIdentity(candidate) === season.id);
      const rawCmd = row?.cmd;
      const hasCmd = typeof rawCmd === "string" && rawCmd.trim().length > 0;
      if (!row || !hasCmd) {
        playbackRefs.push({
          seasonId: season.id,
          label: season.label,
          hasCmd: false,
          cmdType: typeof rawCmd,
          cmdLength: typeof rawCmd === "string" ? rawCmd.length : 0,
          probe: async () => ({
            classification: "EVIDENCE_REQUIRED",
            httpStatus: null,
            payloadShape: "none",
            itemCount: 0,
            fieldNames: [],
            samplePrimitives: [],
            wrapperPrefix: false,
            returnedFieldNames: [],
            extraTransportHints: false,
          }),
        });
        continue;
      }
      playbackRefs.push({
        seasonId: season.id,
        label: season.label,
        hasCmd: true,
        cmdType: "string",
        cmdLength: rawCmd.length,
        probe: async (episodeId, probeSignal) => (await probeStalkerSeriesCreateLink(
          session,
          { id: season.id, label: season.label, rows: [{ cmd: rawCmd }] },
          { id: episodeId, label: "Episode " + episodeId, seasonId: season.id, row: {} },
          probeSignal,
        )).observation,
      });
    }
    safeLog.info("SERIES_D4_SHAPE_RESPONSE", {
      classification: observation.classification,
      item_count: observation.itemCount,
      total_items: observation.totalItems,
      max_page_items: observation.maxPageItems,
      cur_page: observation.currentPage,
      inspected_rows: rowShapes.length,
      root_fields: rootShape.fieldNames,
    });
    safeLog.info("SERIES_D5_EMBEDDED_HIERARCHY", {
      classification: hierarchy.classification,
      season_count: hierarchy.totalSeasons,
      embedded_episode_count: hierarchy.totalEmbeddedEpisodes,
    });
    return { observation, rootShape, rowShapes, hierarchy, playbackRefs };
  } catch (caught) {
    const message = redactSensitiveText(caught instanceof Error ? caught.message : String(caught));
    return {
      observation: {
        classification: "ERROR",
        httpStatus: null,
        payloadShape: "error",
        itemCount: 0,
        fieldNames: [],
        samplePrimitives: [],
        error: message,
      },
      rootShape: { fieldNames: [], dataFieldType: "absent", rowsCount: 0, objectFields: [] },
      rowShapes: [],
      hierarchy: { classification: "EMPTY", seasons: [], totalSeasons: 0, totalEmbeddedEpisodes: 0 },
      playbackRefs: [],
    };
  } finally {
    linked.cleanup();
  }
}

export const STALKER_SERIES_D4_SHAPE_LIMITS = {
  page: 1,
  maxRowsInspected: D4_MAX_ROWS,
  maxDetailRequests: 1,
  timeoutMs: D4_TIMEOUT_MS,
} as const;

export const STALKER_SERIES_D5_HIERARCHY_LIMITS = {
  maxSeasonRows: D5_MAX_SEASON_ROWS,
  maxEpisodeIdsPerSeason: D5_MAX_EPISODE_IDS_PER_SEASON,
  maxTotalEpisodeIds: D5_MAX_TOTAL_EPISODE_IDS,
  additionalRequests: 0,
} as const;
