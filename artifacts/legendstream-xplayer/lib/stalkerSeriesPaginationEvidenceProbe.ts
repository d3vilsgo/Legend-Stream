import { sha256 } from "@noble/hashes/sha2.js";
import type { StalkerIsolatedSession } from "./stalkerIsolatedLogin";
import type { StalkerSeriesProbeCategory } from "./stalkerSeriesProbe";

const MAX_PAGE_REQUESTS = 3;
const MAX_INSPECTED_ROWS = 3;
const REQUEST_TIMEOUT_MS = 12_000;
const SENSITIVE_FIELD = /(?:cmd|url|uri|token|auth|authorization|cookie|mac|password|secret|credential|user|login|stream|link)/i;
const IMAGE_FIELD = /(?:image|poster|cover|pic|thumb|screenshot|logo)/i;
const USER_METADATA_FIELDS = new Set(["description", "year", "genre", "rating", "director", "actors"]);

type Params = Record<string, string | number | boolean | undefined>;
type ValueShape = "absolute_http_url" | "absolute_https_url" | "relative_path" | "empty" | "mixed" | "unknown";

export type StalkerSeriesEvidenceField = {
  field: string;
  presentCount: number;
  nonEmptyCount: number;
  primitiveTypes: string[];
  sensitive: boolean;
};

export type StalkerSeriesImageCandidate = {
  field: string;
  presentCount: number;
  nonEmptyCount: number;
  valueShape: ValueShape;
};

export type StalkerSeriesPageEvidence = {
  requestedPage: number;
  responseCurPage?: number;
  totalItems?: number;
  maxPageItems?: number;
  returnedRowCount: number;
  firstRowFingerprint?: string;
  lastRowFingerprint?: string;
  overlapWithPreviousPage: number;
  newIdsVsPreviousPage: number;
  identicalSetWithPreviousPage?: boolean;
};

export type StalkerSeriesDetailEvidence = {
  detailSeriesMetadataFields: string[];
  detailSeasonRows: number;
  detailEmbeddedEpisodeCounts: number[];
  detailMetadataSource: "LIST_ONLY" | "DETAIL_ONLY" | "LIST_AND_DETAIL" | "NONE";
};

export type StalkerSeriesEvidenceCandidate = {
  key: string;
  title: string;
};

export type StalkerSeriesPaginationEvidence = {
  pages: StalkerSeriesPageEvidence[];
  fieldInventory: StalkerSeriesEvidenceField[];
  imageCandidates: StalkerSeriesImageCandidate[];
  metadata: Record<"description" | "year" | "genre" | "rating" | "director" | "actors", { observed: boolean; nonEmpty: boolean; types: string[] }>;
  otherUserFacingFields: string[];
  detailCandidates: StalkerSeriesEvidenceCandidate[];
  maxPageRequests: 3;
  createLinkRequests: 0;
  playerHandoffs: 0;
  fallbackDialects: 0;
};

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function envelope(payload: unknown) {
  const root = asObject(payload);
  if (!root) return null;
  const js = asObject(root.js);
  if (js) return js;
  const data = asObject(root.data);
  if (data && (Array.isArray(data.data) || Array.isArray(data.items) || data.total_items != null || data.max_page_items != null || data.cur_page != null)) return data;
  return root;
}

function rowsFromPayload(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) return payload.map(asObject).filter((row): row is Record<string, unknown> => Boolean(row));
  const env = envelope(payload);
  if (!env) return [];
  const raw = Array.isArray(env.data) ? env.data : Array.isArray(env.items) ? env.items : [];
  return raw.map(asObject).filter((row): row is Record<string, unknown> => Boolean(row));
}

function finite(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : undefined;
}

function exactId(row: Record<string, unknown>): string | null {
  const value = row.id ?? row.series_id;
  if (typeof value === "string" && value.length) return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function safeTitle(row: Record<string, unknown>, fallback: string) {
  const value = row.name ?? row.title;
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 80) : fallback;
}

function isNonEmpty(value: unknown) {
  if (value == null) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value as Record<string, unknown>).length > 0;
  return true;
}

function valueType(value: unknown) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function classifyImageValue(value: unknown): Exclude<ValueShape, "mixed"> {
  if (typeof value !== "string") return isNonEmpty(value) ? "unknown" : "empty";
  const text = value.trim();
  if (!text) return "empty";
  if (/^https:\/\//i.test(text)) return "absolute_https_url";
  if (/^http:\/\//i.test(text)) return "absolute_http_url";
  if (/^(?:\/|\.\/|\.\.\/)/.test(text) || !/^[a-z][a-z0-9+.-]*:/i.test(text)) return "relative_path";
  return "unknown";
}

export function fingerprintSeriesId(value: string) {
  return Array.from(sha256(new TextEncoder().encode(value)), (byte) => byte.toString(16).padStart(2, "0")).join("").slice(0, 8);
}

function sameSet(left: Set<string>, right: Set<string>) {
  if (left.size !== right.size) return false;
  for (const value of left) if (!right.has(value)) return false;
  return true;
}

export function compareSeriesIdSets(current: Set<string>, previous?: Set<string>) {
  if (!previous) return { overlap: 0, fresh: current.size, identical: undefined as boolean | undefined };
  let overlap = 0;
  for (const value of current) if (previous.has(value)) overlap += 1;
  return { overlap, fresh: current.size - overlap, identical: sameSet(current, previous) };
}

export function buildSeriesFieldInventory(rows: readonly Record<string, unknown>[]) {
  const inspected = rows.slice(0, MAX_INSPECTED_ROWS);
  const fields = new Map<string, { present: number; nonEmpty: number; types: Set<string>; sensitive: boolean; imageShapes: Set<Exclude<ValueShape, "mixed">> }>();
  for (const row of inspected) {
    for (const field of Object.keys(row).sort()) {
      const value = row[field];
      const entry = fields.get(field) ?? { present: 0, nonEmpty: 0, types: new Set<string>(), sensitive: SENSITIVE_FIELD.test(field), imageShapes: new Set<Exclude<ValueShape, "mixed">>() };
      entry.present += 1;
      if (isNonEmpty(value)) entry.nonEmpty += 1;
      entry.types.add(valueType(value));
      if (IMAGE_FIELD.test(field)) entry.imageShapes.add(classifyImageValue(value));
      fields.set(field, entry);
    }
  }
  const fieldInventory: StalkerSeriesEvidenceField[] = [...fields.entries()].map(([field, value]) => ({
    field,
    presentCount: value.present,
    nonEmptyCount: value.nonEmpty,
    primitiveTypes: [...value.types].sort(),
    sensitive: value.sensitive,
  }));
  const imageCandidates: StalkerSeriesImageCandidate[] = [...fields.entries()]
    .filter(([field]) => IMAGE_FIELD.test(field))
    .map(([field, value]) => ({
      field,
      presentCount: value.present,
      nonEmptyCount: value.nonEmpty,
      valueShape: value.imageShapes.size === 0 ? "unknown" : value.imageShapes.size === 1 ? [...value.imageShapes][0]! : "mixed",
    }));
  return { fieldInventory, imageCandidates };
}

function linkedSignal(external?: AbortSignal) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  external?.addEventListener("abort", abort, { once: true });
  if (external?.aborted) controller.abort();
  const timer = setTimeout(abort, REQUEST_TIMEOUT_MS);
  return {
    signal: controller.signal,
    cleanup() {
      clearTimeout(timer);
      external?.removeEventListener("abort", abort);
    },
  };
}

async function request(session: StalkerIsolatedSession, params: Params, signal?: AbortSignal) {
  const linked = linkedSignal(signal);
  try {
    return await session.request(params, linked.signal, undefined, { providerId: "r16-d8-bp-series-evidence" });
  } finally {
    linked.cleanup();
  }
}

function detailMetadataFields(payload: unknown) {
  const root = asObject(payload);
  const env = envelope(payload);
  const selected = asObject(root?.selected_item) ?? asObject(env?.selected_item);
  const names = new Set<string>();
  for (const source of [root, env, selected]) {
    if (!source) continue;
    for (const field of Object.keys(source)) {
      if (SENSITIVE_FIELD.test(field)) continue;
      if (USER_METADATA_FIELDS.has(field) || IMAGE_FIELD.test(field)) names.add(field);
    }
  }
  return [...names].sort();
}

export function createStalkerSeriesPaginationEvidenceProbe(session: StalkerIsolatedSession) {
  let pageProbeUsed = false;
  let detailProbeUsed = false;
  const candidateIds = new Map<string, string>();
  let listMetadataFields = new Set<string>();

  return {
    async runPages(category: StalkerSeriesProbeCategory, signal?: AbortSignal): Promise<StalkerSeriesPaginationEvidence> {
      if (pageProbeUsed) throw new Error("R16-D8-BP page probe is single-use.");
      pageProbeUsed = true;
      const pages: StalkerSeriesPageEvidence[] = [];
      let previousIds: Set<string> | undefined;
      let inspectedRows: Record<string, unknown>[] = [];

      for (let requestedPage = 1; requestedPage <= MAX_PAGE_REQUESTS; requestedPage += 1) {
        const payload = await request(session, { type: "series", action: "get_ordered_list", category: category.id, p: requestedPage }, signal);
        const env = envelope(payload);
        const rows = rowsFromPayload(payload);
        const ids = new Set<string>();
        for (const row of rows) {
          const id = exactId(row);
          if (id) ids.add(id);
        }
        const comparison = compareSeriesIdSets(ids, previousIds);
        const firstId = exactId(rows[0] ?? {});
        const lastId = exactId(rows.at(-1) ?? {});
        pages.push({
          requestedPage,
          ...(finite(env?.cur_page) === undefined ? {} : { responseCurPage: finite(env?.cur_page) }),
          ...(finite(env?.total_items) === undefined ? {} : { totalItems: finite(env?.total_items) }),
          ...(finite(env?.max_page_items) === undefined ? {} : { maxPageItems: finite(env?.max_page_items) }),
          returnedRowCount: rows.length,
          ...(firstId ? { firstRowFingerprint: fingerprintSeriesId(firstId) } : {}),
          ...(lastId ? { lastRowFingerprint: fingerprintSeriesId(lastId) } : {}),
          overlapWithPreviousPage: comparison.overlap,
          newIdsVsPreviousPage: comparison.fresh,
          ...(comparison.identical === undefined ? {} : { identicalSetWithPreviousPage: comparison.identical }),
        });
        if (requestedPage === 1) {
          inspectedRows = rows.slice(0, MAX_INSPECTED_ROWS);
          for (const row of rows.slice(0, 30)) {
            const id = exactId(row);
            if (!id) continue;
            const key = fingerprintSeriesId(id);
            candidateIds.set(key, id);
          }
        }
        previousIds = ids;
      }

      const { fieldInventory, imageCandidates } = buildSeriesFieldInventory(inspectedRows);
      listMetadataFields = new Set(fieldInventory.filter((field) => USER_METADATA_FIELDS.has(field.field) && field.nonEmptyCount > 0).map((field) => field.field));
      const metadata = Object.fromEntries(["description", "year", "genre", "rating", "director", "actors"].map((field) => {
        const observed = fieldInventory.find((item) => item.field === field);
        return [field, { observed: Boolean(observed), nonEmpty: Boolean(observed?.nonEmptyCount), types: observed?.primitiveTypes ?? [] }];
      })) as StalkerSeriesPaginationEvidence["metadata"];
      const otherUserFacingFields = fieldInventory
        .filter((field) => !field.sensitive && !USER_METADATA_FIELDS.has(field.field) && !["id", "series_id", "category_id"].includes(field.field))
        .map((field) => field.field);
      const detailCandidates = inspectedRows.flatMap((row) => {
        const id = exactId(row);
        if (!id) return [];
        const key = fingerprintSeriesId(id);
        return [{ key, title: safeTitle(row, `Series ${key}`) }];
      });
      return { pages, fieldInventory, imageCandidates, metadata, otherUserFacingFields, detailCandidates, maxPageRequests: 3, createLinkRequests: 0, playerHandoffs: 0, fallbackDialects: 0 };
    },

    async runDetail(candidateKey: string, signal?: AbortSignal): Promise<StalkerSeriesDetailEvidence> {
      if (detailProbeUsed) throw new Error("R16-D8-BP detail probe is single-use.");
      const rawId = candidateIds.get(candidateKey);
      if (!rawId) throw new Error("R16-D8-BP detail candidate is unavailable.");
      detailProbeUsed = true;
      const payload = await request(session, { type: "series", action: "get_ordered_list", movie_id: rawId, p: 1 }, signal);
      const rows = rowsFromPayload(payload);
      const detailFields = detailMetadataFields(payload);
      const detailHasMetadata = detailFields.length > 0;
      const listHasMetadata = listMetadataFields.size > 0;
      const detailMetadataSource: StalkerSeriesDetailEvidence["detailMetadataSource"] = listHasMetadata && detailHasMetadata
        ? "LIST_AND_DETAIL"
        : listHasMetadata
          ? "LIST_ONLY"
          : detailHasMetadata
            ? "DETAIL_ONLY"
            : "NONE";
      return {
        detailSeriesMetadataFields: detailFields,
        detailSeasonRows: rows.length,
        detailEmbeddedEpisodeCounts: rows.map((row) => Array.isArray(row.series) ? row.series.length : 0),
        detailMetadataSource,
      };
    },
  };
}

export const STALKER_SERIES_D8_BP_LIMITS = {
  maxPageRequests: MAX_PAGE_REQUESTS,
  maxInspectedRows: MAX_INSPECTED_ROWS,
  maxDetailRequests: 1,
  maxCreateLinkRequests: 0,
  playerHandoffs: 0,
  fallbackDialects: 0,
  timeoutMs: REQUEST_TIMEOUT_MS,
} as const;
