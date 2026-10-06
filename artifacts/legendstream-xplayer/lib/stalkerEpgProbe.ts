// Temporary R18-E0P: structural evidence only; never returns programme data.
type Row = Record<string, unknown>;
const FIELDS = ["id", "ch_id", "channel_id", "real_id", "name", "title", "descr", "description", "start", "end", "time", "time_to", "start_timestamp", "stop_timestamp", "duration"] as const;
const TIMES = ["start", "end", "time", "time_to", "start_timestamp", "stop_timestamp", "duration"] as const;
type Identity = { portalId?: string; tvgId?: string };
type Session = {
  request(params: Record<string, string | number>, signal?: AbortSignal, onTiming?: (timing: { fetchWaitMs: number; bodyReadWaitMs: number }) => void): Promise<unknown>;
  isAuthenticated(): boolean;
};
type ProbeOptions = {
  getSession: () => Session;
  getIdentity: () => Promise<Identity>;
  log: (event: string, fields: Record<string, unknown>) => void;
  observe?: (event: string, fields: Record<string, unknown>) => void;
};
const object = (value: unknown): Row | null => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Row : null;
const present = (value: unknown) => typeof value === "string" && value.length > 0;
const shape = (value: unknown): string => value === null ? "null" : Array.isArray(value) ? "array" : typeof value;

export function epgProbeTimeShape(value: unknown) {
  const kind = typeof value === "number" ? "number" : typeof value === "string"
    ? /^-?\d+(?:\.\d+)?$/.test(value) ? "numeric_string"
      : /^\d{4}-\d\d-\d\dT/.test(value) ? "ISO_like_string"
        : /^\d{4}[-/]\d\d[-/]\d\d[ T]\d\d:\d\d/.test(value) ? "datetime_string" : "unknown"
    : value === null ? "null" : "unknown";
  const numeric = kind === "number" || kind === "numeric_string" ? Number(value) : NaN;
  const magnitude = Number.isFinite(numeric) && numeric >= 1e9 && numeric < 1e11 ? "unix_seconds_candidate"
    : Number.isFinite(numeric) && numeric >= 1e12 && numeric < 1e14 ? "unix_milliseconds_candidate" : "unknown";
  return { kind, magnitude };
}

function textShape(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return "unknown";
  return value.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(value)
    ? "base64_candidate" : "plain_text_candidate";
}

export function inspectEpgProbeResponse(payload: unknown, identity: Identity = {}) {
  const root = object(payload);
  const data = root && Object.hasOwn(root, "data") ? root.data : payload;
  const rows: Row[] = [];
  let itemCount = 0;
  let sampledGroups = 0;
  let countScope = "EXACT";
  const add = (value: unknown) => {
    if (!Array.isArray(value)) return;
    itemCount += value.length;
    for (let i = 0; i < Math.min(value.length, 3) && rows.length < 3; i++) {
      const row = object(value[i]);
      if (row) rows.push(row);
    }
  };
  if (Array.isArray(data)) add(data);
  else if (object(data)) {
    const container = data as Row;
    if (FIELDS.some((field) => Object.hasOwn(container, field))) {
      itemCount = 1;
      rows.push(container);
    } else {
      // Bulk dialects may key arrays by channel identity. Never log those keys.
      countScope = "SAMPLED_GROUPS";
      for (const key in container) {
        if (!Object.hasOwn(container, key)) continue;
        if (sampledGroups++ >= 8) break;
        add(container[key]);
      }
    }
  }
  const hasStart = (row: Row) => ["start_timestamp", "start", "time"].some((f) => {
    const s = epgProbeTimeShape(row[f]);
    return s.kind !== "unknown" && s.kind !== "null";
  });
  const hasEnd = (row: Row) => ["stop_timestamp", "end", "time_to", "duration"].some((f) => {
    const s = epgProbeTimeShape(row[f]);
    return s.kind !== "unknown" && s.kind !== "null";
  });
  const usableShape = rows.some((row) => (present(row.name) || present(row.title)) && hasStart(row) && hasEnd(row));
  const fieldNames = FIELDS.filter((f) => rows.some((row) => Object.hasOwn(row, f)));
  const fieldTypes = fieldNames.map((field) => ({ field, types: [...new Set(rows.filter((r) => Object.hasOwn(r, field)).map((r) => shape(r[field])))] }));
  const timeShapes = TIMES.filter((f) => rows.some((r) => Object.hasOwn(r, f)))
    .map((field) => ({ field, samples: rows.filter((r) => Object.hasOwn(r, field)).map((r) => epgProbeTimeShape(r[field])) }));
  const texts = [...new Set(rows.flatMap((r) => ["name", "title", "descr", "description"].filter((f) => Object.hasOwn(r, f)).map((f) => textShape(r[f]))))];
  const channelValues = rows.flatMap((r) => [r.ch_id, r.channel_id]).filter((v) => typeof v === "string" || typeof v === "number").map(String);
  const match = (candidate?: string) => !candidate || !channelValues.length ? "UNKNOWN" : channelValues.includes(candidate) ? "YES" : "NO";
  return {
    usableShape,
    topLevelShape: shape(payload), dataContainerPresent: Boolean(root && Object.hasOwn(root, "data")),
    dataShape: shape(data), itemCount, countScope, sampledGroups: Math.min(sampledGroups, 8), sampledRows: rows.length,
    fieldNames, fieldTypes, timeShapes, textShape: texts.length > 1 ? "mixed_candidate" : texts[0] ?? "unknown",
    responseHasChannelIdentity: channelValues.length > 0,
    responseMatchesPortalId: match(identity.portalId), responseMatchesTvgId: match(identity.tvgId),
    selectedPortalKeyPresent: Boolean(identity.portalId && object(data) && Object.hasOwn(data as Row, identity.portalId)),
    timeSemantics: "AMBIGUOUS", mappingStatus: "UNCONFIRMED",
  };
}

function failure(error: unknown, aborted: boolean) {
  if (aborted) return "ABORT";
  const code = object(error)?.code;
  if (code === "CANCELLED") return "ABORT";
  if (code === "MISSING_MAC") return "PRE_NETWORK_MISSING_MAC";
  if (code === "INVALID_URL") return "PRE_NETWORK_INVALID_URL";
  if (code === "NETWORK_ERROR") return "NETWORK";
  if (code === "PORTAL_RATE_LIMITED_OR_ANTI_DDOS") return "PORTAL_PROTECTION";
  if (code === "AUTH_FAILED" || code === "MISSING_TOKEN") return "AUTH";
  if (code === "TIMEOUT") return "TIMEOUT";
  if (code === "HTTP_ERROR") return "HTTP";
  if (code === "INVALID_RESPONSE") return "INVALID_SHAPE";
  return "UNKNOWN";
}

export class StalkerEpgProbe {
  private running: { controller: AbortController; promise: Promise<void> } | null = null;
  private sequence = 0;

  cancel() { this.running?.controller.abort(); }

  run(options: ProbeOptions): Promise<void> {
    if (this.running) return this.running.promise;
    const controller = new AbortController();
    const attempt = ++this.sequence;
    const emit = (event: string, fields: Record<string, unknown>) => {
      try { options.log(`R18_E0P_${event}`, { attempt, ...fields }); } catch { /* Observation is fail-open. */ }
      try { options.observe?.(event, fields); } catch { /* Observation is fail-open. */ }
    };
    const current = () => {
      if (controller.signal.aborted) throw { code: "CANCELLED" };
    };
    const clock = () => globalThis.performance?.now?.() ?? Date.now();
    // Diagnostic-only ceiling; the shared session retains its existing timeout/auth policy.
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, 65_000);
    const promise = Promise.resolve().then(async () => {
      try {
        current();
        const session = options.getSession();
        emit("BEGIN", { providerType: "stalker", authenticatedAtStart: session.isAuthenticated(), sessionAuthority: "EXISTING_RUNTIME" });
        const identity = await options.getIdentity();
        current();
        emit("IDENTITY", {
          hasPortalId: Boolean(identity.portalId), hasPlaybackPortalId: Boolean(identity.portalId), hasTvgId: Boolean(identity.tvgId),
          candidateIdentitySource: identity.portalId ? "PERSISTED_PLAYBACK_PORTAL_ID" : "NONE",
          identityRelationship: identity.portalId && identity.tvgId ? identity.portalId === identity.tvgId ? "SAME" : "DIFFERENT" : "UNKNOWN",
          mappingStatus: "UNCONFIRMED",
        });
        const probe = async (action: "get_epg_info" | "get_short_epg", probeId: number) => {
          current();
          emit("PROBE", { probeId, type: "itv", action });
          const started = clock();
          try {
            const params: Record<string, string | number> = { type: "itv", action };
            if (action === "get_short_epg") params.ch_id = identity.portalId!;
            // Server source: Itv::getEpgInfo defaults period; getShortEpg accepts
            // ch_id and defaults to current + five. No guessed identity variants.
            const payload = await session.request(params, controller.signal, (timing) => {
              emit("FETCH_DONE", { probeId, fetchWaitMs: timing.fetchWaitMs });
            });
            current();
            const { timeShapes, fieldTypes, ...summary } = inspectEpgProbeResponse(payload, identity);
            emit("RESPONSE", { probeId, elapsedMs: Math.max(0, Math.round(clock() - started)), httpStatus: "NOT_EXPOSED", wrapper: "UNWRAPPED_BY_SESSION", ...summary });
            emit("FIELDS", { probeId, fieldTypes });
            for (const time of timeShapes) emit("TIME", { probeId, ...time, timeSemantics: "AMBIGUOUS" });
            return summary.usableShape;
          } catch (error) {
            const errorClass = failure(error, controller.signal.aborted);
            const status = object(error)?.status;
            const httpStatus = typeof status === "number" && Number.isInteger(status) && status >= 100 && status <= 599 ? status : "NOT_EXPOSED";
            emit("ERROR", { probeId, errorClass, httpStatus, elapsedMs: Math.max(0, Math.round(clock() - started)) });
            // An empty/invalid response or unsupported action may justify one fallback.
            if (errorClass === "INVALID_SHAPE" || (errorClass === "HTTP" && [400, 404, 405, 501].includes(Number(httpStatus)))) return false;
            throw error;
          }
        };
        if (await probe("get_epg_info", 1)) {
          emit("RESULT", { status: "SUPPORTED_SHAPE", capability: "get_epg_info", timeSemantics: "AMBIGUOUS" });
        } else if (!identity.portalId) {
          emit("RESULT", { status: "INCONCLUSIVE", reason: "NO_CANONICAL_CHANNEL_IDENTITY" });
        } else {
          current();
          const observed = await probe("get_short_epg", 2);
          emit("RESULT", { status: observed ? "SUPPORTED_SHAPE" : "INCONCLUSIVE", capability: "get_short_epg", timeSemantics: "AMBIGUOUS" });
        }
      } catch (error) {
        emit("RESULT", { status: "FAILED", errorClass: timedOut ? "TIMEOUT" : failure(error, controller.signal.aborted) });
        if (timedOut) emit("TIMEOUT", {});
      } finally {
        clearTimeout(timer);
        if (this.running?.controller === controller) this.running = null;
      }
    });
    this.running = { controller, promise };
    return promise;
  }
}
