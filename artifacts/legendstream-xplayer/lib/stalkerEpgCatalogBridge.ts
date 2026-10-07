// Temporary session-scoped evidence, never persisted or returned to product state.
type Row = Record<string, unknown>;
type Evidence = { appId: string; portalId: string; id?: string; ch_id?: string; stream_id?: string; hasId: boolean; hasCh: boolean; hasStream: boolean; source: "ID" | "CH_ID" | "STREAM_ID" | "UNKNOWN" };
export type CatalogBridgeSample = { rows: readonly Evidence[]; selected?: Evidence };
const retained = new WeakMap<object, { providerId: string; rows: Evidence[] }>();
const object = (v: unknown): Row | null => v !== null && typeof v === "object" && !Array.isArray(v) ? v as Row : null;
const own = (row: Row, key: string) => Object.hasOwn(row, key) ? row[key] : undefined;
// Exactly the catalog's existing stringValue rule, not an alternate identity.
const scalar = (v: unknown) => typeof v === "string" ? v.trim() : typeof v === "number" && Number.isFinite(v) ? String(v) : "";
const boundedScalar = (v: unknown) => { const value = scalar(v); return value && value.length <= 512 ? value : undefined; };
type Truth = "YES" | "NO" | "UNKNOWN";
const eq = (a?: string, b?: string): Truth => !a || !b ? "UNKNOWN" : a === b ? "YES" : "NO";

// Called only after the actual ordered Live page was normalized and persisted.
// Same-index pairing is guaranteed by normalizeStalkerLivePage's one-row/one-item loop.
export function retainStalkerCatalogBridge(session: object, providerId: string, raw: readonly Row[], normalized: readonly { id: string; portalId: string }[], canonicalOrdered = true) {
  try {
    retained.delete(session);
    if (!canonicalOrdered || raw.length !== normalized.length) return;
    const rows: Evidence[] = [];
    const seen = new Set<string>();
    const ambiguous = new Set<string>();
    // Refuse oversize pages rather than miss duplicate identities beyond a prefix.
    if (raw.length > 256) return;
    for (let i = 0; i < raw.length; i++) {
      const channel = normalized[i];
      if (seen.has(channel.id)) { ambiguous.add(channel.id); continue; }
      seen.add(channel.id);
      if (rows.length >= 32) continue;
      const row = raw[i];
      const id = own(row, "id"), ch = own(row, "ch_id"), stream = own(row, "stream_id");
      // Corroborate against the real normalized channel, never synthesize Channel.id.
      if (scalar(id ?? ch ?? stream) !== channel.portalId) continue;
      rows.push({ appId: channel.id, portalId: channel.portalId,
        id: boundedScalar(id), ch_id: boundedScalar(ch), stream_id: boundedScalar(stream),
        hasId: id != null, hasCh: ch != null, hasStream: stream != null,
        source: id != null ? "ID" : ch != null ? "CH_ID" : stream != null ? "STREAM_ID" : "UNKNOWN" });
    }
    retained.set(session, { providerId, rows: rows.filter((row) => !ambiguous.has(row.appId)) });
  } catch { /* Diagnostic capture cannot fail a catalog load. */ }
}

export function snapshotStalkerCatalogBridge(session: object, providerId: string, selectedAppId: string): CatalogBridgeSample {
  const entry = retained.get(session);
  const rows = entry?.providerId === providerId ? entry.rows.map((row) => ({ ...row })) : [];
  return { rows, selected: rows.find((row) => row.appId === selectedAppId) };
}

export const CATALOG_RELATIONS = ["id_present", "ch_id_present", "stream_id_present", "id_eq_ch_id", "id_eq_stream_id", "ch_id_eq_stream_id", "portalId_eq_id", "portalId_eq_ch_id", "portalId_eq_stream_id"] as const;
export const BRIDGE_RELATIONS = ["catalog_id_is_epg_key", "catalog_ch_id_is_epg_key", "catalog_stream_id_is_epg_key", "portalId_is_epg_key", "catalog_id_eq_epg_ch_id", "catalog_ch_id_eq_epg_ch_id", "catalog_stream_id_eq_epg_ch_id"] as const;
export const BRIDGE_SAMPLE_FIELDS = ["id_present", "ch_id_present", "id_eq_ch_id", "catalog_id_is_epg_key", "catalog_ch_id_is_epg_key", "portalId_is_epg_key"] as const;

function classify(payload: unknown, row?: Evidence) {
  const root = object(payload);
  const data = object(root && Object.hasOwn(root, "data") ? root.data : payload);
  const key = (id?: string): Truth => !id || !data ? "UNKNOWN" : Object.hasOwn(data, id) ? "YES" : "NO";
  // Inspect only the exact candidate group. NO is local to that group, not a
  // claim that no other EPG group could contain the candidate ch_id.
  const groupCh = (id?: string): Truth => {
    if (!id || !data || !Object.hasOwn(data, id)) return "UNKNOWN";
    const values = data[id];
    if (!Array.isArray(values) || !values.length) return "UNKNOWN";
    let comparable = 0;
    for (let i = 0; i < Math.min(values.length, 64); i++) {
      const epg = object(values[i]);
      const ch = epg ? boundedScalar(own(epg, "ch_id")) : undefined;
      if (!ch) continue;
      comparable++;
      if (ch === id) return "YES";
    }
    return values.length > 64 || comparable !== values.length ? "UNKNOWN" : "NO";
  };
  const id = row?.id, ch = row?.ch_id, stream = row?.stream_id, portal = row?.portalId;
  const present = (v?: boolean): Truth => !row ? "UNKNOWN" : v ? "YES" : "NO";
  return {
    id_present: present(row?.hasId), ch_id_present: present(row?.hasCh), stream_id_present: present(row?.hasStream),
    id_eq_ch_id: eq(id, ch), id_eq_stream_id: eq(id, stream), ch_id_eq_stream_id: eq(ch, stream),
    portalId_source: row?.source ?? "UNKNOWN",
    portalId_eq_id: eq(portal, id), portalId_eq_ch_id: eq(portal, ch), portalId_eq_stream_id: eq(portal, stream),
    catalog_id_is_epg_key: key(id), catalog_ch_id_is_epg_key: key(ch), catalog_stream_id_is_epg_key: key(stream), portalId_is_epg_key: key(portal),
    catalog_id_eq_epg_ch_id: groupCh(id), catalog_ch_id_eq_epg_ch_id: groupCh(ch), catalog_stream_id_eq_epg_ch_id: groupCh(stream),
  };
}

export function inspectStalkerCatalogBridge(payload: unknown, sample: CatalogBridgeSample = { rows: [] }, selectedPortalId?: string) {
  const rows = sample.rows.slice(0, 32);
  const selected = sample.selected && sample.selected.portalId === selectedPortalId ? sample.selected : undefined;
  const aggregates = Object.fromEntries(BRIDGE_SAMPLE_FIELDS.map((field) => [field, { YES: 0, NO: 0, UNKNOWN: 0 }])) as Record<typeof BRIDGE_SAMPLE_FIELDS[number], Record<Truth, number>>;
  for (const row of rows) {
    const value = classify(payload, row);
    for (const field of BRIDGE_SAMPLE_FIELDS) aggregates[field][value[field]]++;
  }
  return {
    selected: classify(payload, selected), channels: rows.length, scope: "BOUNDED",
    rowComparisonScope: "EXACT_CANDIDATE_GROUP_FIRST_64",
    aggregates: Object.fromEntries(BRIDGE_SAMPLE_FIELDS.map((field) => {
      const counts = aggregates[field];
      const confidence = counts.YES && counts.NO ? "MIXED" : counts.UNKNOWN || !rows.length ? "UNKNOWN"
        : counts.YES ? "BOUNDED_ALL_OBSERVED" : "BOUNDED_NONE_OBSERVED";
      return [field, { ...counts, confidence }];
    })),
  };
}
