import { redactSensitiveText, safeLog } from "./safeLog";
import type { StalkerIsolatedSession } from "./stalkerIsolatedLogin";
import { observeStalkerSeriesPayload, type StalkerSeriesProbeItem, type StalkerSeriesProbeObservation } from "./stalkerSeriesProbe";

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

export type StalkerSeriesPhysicalShapeProbe = {
  observation: StalkerSeriesProbeObservation;
  rootShape: StalkerSeriesRootShape;
  rowShapes: StalkerSeriesRowShape[];
};

const D4_TIMEOUT_MS = 12_000;
const D4_MAX_ROWS = 3;
const sensitiveFieldName = /(?:cmd|url|uri|token|auth|authorization|cookie|mac|password|secret|credential|user|login|stream|link)/i;

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
    const observation = observeStalkerSeriesPayload(payload);
    const rowShapes = rowsFromEnvelope(payload)
      .slice(0, D4_MAX_ROWS)
      .map(asObject)
      .filter((row): row is Record<string, unknown> => Boolean(row))
      .map((row, index) => inspectStalkerSeriesRowShape(row, index + 1));
    const rootShape = inspectStalkerSeriesRootShape(payload);
    safeLog.info("SERIES_D4_SHAPE_RESPONSE", {
      classification: observation.classification,
      item_count: observation.itemCount,
      total_items: observation.totalItems,
      max_page_items: observation.maxPageItems,
      cur_page: observation.currentPage,
      inspected_rows: rowShapes.length,
      root_fields: rootShape.fieldNames,
    });
    return { observation, rootShape, rowShapes };
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
