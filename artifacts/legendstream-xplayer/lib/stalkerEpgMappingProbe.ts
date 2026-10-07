// Temporary observation of the existing bulk response, never a product mapper.
// No response values or keys escape this function. Negative bounded scans are
// UNPROVEN, not evidence that a relationship does not exist.
type Row = Record<string, unknown>;
const object = (v: unknown): Row | null => v !== null && typeof v === "object" && !Array.isArray(v) ? v as Row : null;
const scalar = (v: unknown) => typeof v === "string" ? v : typeof v === "number" && Number.isSafeInteger(v) ? String(v) : undefined;
const own = (row: Row, field: string) => Object.hasOwn(row, field) ? row[field] : undefined;
const identityFields = ["ch_id", "real_id", "id"] as const;

export function inspectStalkerEpgMapping(payload: unknown, identity: { portalId?: string; tvgId?: string }) {
  const root = object(payload);
  const wrapped = Boolean(root && Object.hasOwn(root, "data"));
  const data = wrapped ? root!.data : payload;
  const container = object(data);
  const portal = identity.portalId || undefined;
  const tvg = identity.tvgId || undefined;
  const keyPresent = (id?: string) => !id || !container ? "UNKNOWN" : Object.hasOwn(container, id) ? "YES" : "NO";
  const selected = portal && container ? own(container, portal) : undefined;
  const selectedRows = Array.isArray(selected) ? selected.slice(0, 256) : [];
  const relation = (field: string) => {
    if (!portal || !selectedRows.length) return "UNKNOWN";
    let matches = 0;
    let present = 0;
    for (const value of selectedRows) {
      const row = object(value);
      const id = row ? scalar(own(row, field)) : undefined;
      if (id !== undefined) { present++; if (id === portal) matches++; }
    }
    return !present ? "UNKNOWN" : matches === selectedRows.length ? "ALL" : matches ? "SOME" : "NONE";
  };
  const portalMatches = new Set<string>();
  const tvgMatches = new Set<string>();
  let groups = 0;
  let rows = 0;
  let complete = true;
  let supported = true;
  const scan = (values: unknown[]) => {
    for (const value of values) {
      if (rows >= 4096) { complete = false; return; }
      rows++;
      const row = object(value);
      if (!row) { supported = false; continue; }
      for (const field of identityFields) {
        const id = scalar(own(row, field));
        if (portal && id === portal) portalMatches.add(field);
        if (tvg && id === tvg) tvgMatches.add(field);
      }
    }
  };
  if (Array.isArray(data)) scan(data);
  else if (container) {
    // Do not guess recursive wrappers or interpret an arbitrary object as a row.
    for (const key in container) {
      if (!Object.hasOwn(container, key)) continue;
      if (groups >= 1024 || rows >= 4096) { complete = false; break; }
      groups++;
      const group = container[key];
      if (Array.isArray(group)) scan(group);
      else supported = false;
    }
  } else supported = false;
  const match = (matches: Set<string>, field: string, id?: string) => !id ? "UNKNOWN"
    : matches.has(field) ? "YES" : complete && supported ? "NO" : "UNPROVEN";
  return {
    container: Array.isArray(data) ? wrapped ? "DATA_ARRAY" : "ROOT_ARRAY"
      : container ? wrapped ? "DATA_OBJECT" : "ROOT_OBJECT" : "UNSUPPORTED",
    portalKey: keyPresent(portal), tvgKey: keyPresent(tvg),
    selectedGroup: Array.isArray(selected) ? "ARRAY" : selected === undefined ? "ABSENT" : "OTHER",
    selectedRows: selectedRows.length,
    selectedComplete: Array.isArray(selected) && selected.length <= 256 ? "YES" : "NO",
    selectedChId: relation("ch_id"), selectedRealId: relation("real_id"),
    scanScope: !supported ? "UNSUPPORTED" : complete ? "COMPLETE" : "BOUNDED",
    scannedGroups: groups, scannedRows: rows,
    portalChId: match(portalMatches, "ch_id", portal),
    portalRealId: match(portalMatches, "real_id", portal),
    portalRowId: match(portalMatches, "id", portal),
    tvgChId: match(tvgMatches, "ch_id", tvg),
    tvgRealId: match(tvgMatches, "real_id", tvg),
  };
}
