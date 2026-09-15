import { redactSensitiveText } from "./safeLog";
import type { StalkerIsolatedSession } from "./stalkerIsolatedLogin";

export type StalkerVodProbeCategory = {
  id: string;
  title: string;
  idField: string;
  titleField: string;
};

export type StalkerVodProbeItem = {
  id: string;
  title: string;
  cmd: string;
  idField: string;
  titleField: string;
  cmdField: "cmd";
};

export type StalkerVodProbeObservation = {
  classification: "SUCCESS" | "EMPTY" | "UNSUPPORTED" | "ERROR";
  rootType: string;
  count: number;
  fieldTypes: string[];
  paginationFieldTypes: string[];
  error?: string;
};

export type StalkerVodCreateLinkObservation = {
  classification: "SUCCESS" | "EMPTY" | "UNSUPPORTED" | "ERROR";
  rootType: string;
  fieldTypes: string[];
  resolvedScheme?: string;
  extraTransportHints: boolean;
  error?: string;
};

const unsupportedPattern = /\b(?:unknown|unsupported|not\s+implemented|not\s+available)\b/i;

function rootType(value: unknown) {
  if (Array.isArray(value)) return "array";
  if (value === null) return "null";
  return typeof value;
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function arrayRows(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  const root = asObject(payload);
  if (Array.isArray(root?.js)) return root.js;
  if (Array.isArray(root?.data)) return root.data;
  return [];
}

function stringField(row: Record<string, unknown>, keys: readonly string[]) {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.trim()) return { field: key, value: value.trim() };
    if (typeof value === "number" && Number.isFinite(value)) return { field: key, value: String(value) };
  }
  return null;
}

function fieldTypes(value: unknown) {
  const row = asObject(value);
  if (!row) return [];
  return Object.keys(row).sort().slice(0, 24).map((key) => {
    const item = row[key];
    return `${key}:${Array.isArray(item) ? "array" : item === null ? "null" : typeof item}`;
  });
}

function paginationFieldTypes(payload: unknown) {
  const root = asObject(payload);
  if (!root) return [];
  return ["total_items", "max_page_items", "total", "page", "p", "pages", "total_pages"]
    .filter((key) => key in root)
    .map((key) => `${key}:${typeof root[key]}`);
}

function safeError(caught: unknown) {
  const text = caught instanceof Error ? caught.message : String(caught);
  return redactSensitiveText(text);
}

function unsupportedPayload(payload: unknown) {
  if (typeof payload === "string") return unsupportedPattern.test(payload);
  const root = asObject(payload);
  return root ? [root.error, root.message, root.reason, root.status].some(
    (value) => typeof value === "string" && unsupportedPattern.test(value),
  ) : false;
}

export async function probeStalkerVodCategories(session: StalkerIsolatedSession) {
  try {
    const payload = await session.request(
      { type: "vod", action: "get_categories" },
      undefined,
      undefined,
      { providerId: "r16-bp-vod-categories" },
    );
    const rows = arrayRows(payload);
    const categories: StalkerVodProbeCategory[] = [];
    for (const raw of rows) {
      const row = asObject(raw);
      if (!row) continue;
      const id = stringField(row, ["id", "category_id"]);
      const title = stringField(row, ["title", "name", "category_name"]);
      if (!id || !title) continue;
      categories.push({ id: id.value, title: title.value, idField: id.field, titleField: title.field });
    }
    const observation: StalkerVodProbeObservation = {
      classification: unsupportedPayload(payload) ? "UNSUPPORTED" : categories.length ? "SUCCESS" : "EMPTY",
      rootType: rootType(payload),
      count: categories.length,
      fieldTypes: fieldTypes(rows[0]),
      paginationFieldTypes: paginationFieldTypes(payload),
    };
    return { categories, observation };
  } catch (caught) {
    return {
      categories: [] as StalkerVodProbeCategory[],
      observation: {
        classification: unsupportedPattern.test(caught instanceof Error ? caught.message : String(caught)) ? "UNSUPPORTED" : "ERROR",
        rootType: "error",
        count: 0,
        fieldTypes: [],
        paginationFieldTypes: [],
        error: safeError(caught),
      } satisfies StalkerVodProbeObservation,
    };
  }
}

export async function probeStalkerVodPage(
  session: StalkerIsolatedSession,
  category: StalkerVodProbeCategory,
) {
  try {
    const payload = await session.request(
      { type: "vod", action: "get_ordered_list", category: category.id, p: 1 },
      undefined,
      undefined,
      { providerId: "r16-bp-vod-page" },
    );
    const rows = arrayRows(payload);
    const items: StalkerVodProbeItem[] = [];
    for (const raw of rows) {
      const row = asObject(raw);
      if (!row) continue;
      const id = stringField(row, ["id", "movie_id", "stream_id"]);
      const title = stringField(row, ["name", "title"]);
      const cmd = stringField(row, ["cmd"]);
      if (!id || !title || !cmd) continue;
      items.push({ id: id.value, title: title.value, cmd: cmd.value, idField: id.field, titleField: title.field, cmdField: "cmd" });
    }
    const observation: StalkerVodProbeObservation = {
      classification: unsupportedPayload(payload) ? "UNSUPPORTED" : items.length ? "SUCCESS" : "EMPTY",
      rootType: rootType(payload),
      count: rows.length,
      fieldTypes: fieldTypes(rows[0]),
      paginationFieldTypes: paginationFieldTypes(payload),
    };
    return { items, observation };
  } catch (caught) {
    return {
      items: [] as StalkerVodProbeItem[],
      observation: {
        classification: unsupportedPattern.test(caught instanceof Error ? caught.message : String(caught)) ? "UNSUPPORTED" : "ERROR",
        rootType: "error",
        count: 0,
        fieldTypes: [],
        paginationFieldTypes: [],
        error: safeError(caught),
      } satisfies StalkerVodProbeObservation,
    };
  }
}

function resolvedSource(payload: unknown) {
  if (typeof payload === "string") return payload.replace(/^ffmpeg\s+/i, "").trim();
  const root = asObject(payload);
  const value = root ? stringField(root, ["cmd", "url", "link"])?.value : undefined;
  return value?.replace(/^ffmpeg\s+/i, "").trim() ?? "";
}

export async function probeStalkerVodCreateLink(
  session: StalkerIsolatedSession,
  item: StalkerVodProbeItem,
) {
  try {
    const payload = await session.request(
      { type: "vod", action: "create_link", cmd: item.cmd, disable_ad: 0, download: 0 },
      undefined,
      undefined,
      { providerId: "r16-bp-vod-create-link" },
    );
    const source = resolvedSource(payload);
    let resolvedScheme: string | undefined;
    if (source) {
      try { resolvedScheme = new URL(source).protocol.replace(":", ""); } catch { resolvedScheme = undefined; }
    }
    const root = asObject(payload);
    const keys = root ? Object.keys(root).map((key) => key.toLowerCase()) : [];
    const observation: StalkerVodCreateLinkObservation = {
      classification: unsupportedPayload(payload) ? "UNSUPPORTED" : source && resolvedScheme ? "SUCCESS" : "EMPTY",
      rootType: rootType(payload),
      fieldTypes: fieldTypes(payload),
      resolvedScheme,
      extraTransportHints: keys.some((key) => key.includes("header") || key.includes("cookie")),
    };
    return { observation };
  } catch (caught) {
    return {
      observation: {
        classification: unsupportedPattern.test(caught instanceof Error ? caught.message : String(caught)) ? "UNSUPPORTED" : "ERROR",
        rootType: "error",
        fieldTypes: [],
        extraTransportHints: false,
        error: safeError(caught),
      } satisfies StalkerVodCreateLinkObservation,
    };
  }
}
