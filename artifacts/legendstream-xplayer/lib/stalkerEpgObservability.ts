import type { StalkerEpgProbe } from "./stalkerEpgProbe";

// Temporary, bounded in-memory diagnostic state. Only fixed labels and structural
// allowlists enter the screen or clipboard; provider and programme values cannot.
const shapes = new Set(["array", "object", "string", "number", "boolean", "null", "undefined"]);
const fields = new Set(["id", "ch_id", "channel_id", "real_id", "name", "title", "descr", "description", "start", "end", "time", "time_to", "start_timestamp", "stop_timestamp", "duration"]);
const classes = new Set(["ABORT", "AUTH", "TIMEOUT", "HTTP", "INVALID_SHAPE", "UNKNOWN", "PRE_NETWORK_MISSING_MAC", "PRE_NETWORK_INVALID_URL", "NETWORK", "PORTAL_PROTECTION"]);
const networkEvidence = (errorClass: unknown) => ["HTTP", "PORTAL_PROTECTION", "INVALID_SHAPE"].includes(String(errorClass)) ? "YES"
  : ["PRE_NETWORK_MISSING_MAC", "PRE_NETWORK_INVALID_URL"].includes(String(errorClass)) ? "NO" : "UNPROVEN";
const actions = new Set(["get_epg_info", "get_short_epg"]);
const reasons = new Set(["NO_CANONICAL_CHANNEL_IDENTITY"]);
const kinds = new Set(["number", "numeric_string", "ISO_like_string", "datetime_string", "null", "unknown"]);
const magnitudes = new Set(["unix_seconds_candidate", "unix_milliseconds_candidate", "unknown"]);
const textShapes = new Set(["mixed_candidate", "base64_candidate", "plain_text_candidate", "unknown"]);
const choice = (value: unknown, allowed: Set<string>, fallback = "UNKNOWN") => typeof value === "string" && allowed.has(value) ? value : fallback;
const count = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(99999, Math.round(value))) : 0;
const yes = (value: unknown) => value === true ? "YES" : "NO";
const probeNumber = (value: unknown) => value === 2 ? 2 : 1;
const touchStages = new Set(["TOUCH_DOWN", "TOUCH_UP", "PRESS", "LONG_PRESS"]);
export type StalkerEpgTouchStage = "TOUCH_DOWN" | "TOUCH_UP" | "PRESS" | "LONG_PRESS";

export class StalkerEpgObservability {
  private lines: string[] = ["READY"];
  private structural: string[] = [];
  private listeners = new Set<() => void>();
  private running = false;
  private generation = 0;
  private active: StalkerEpgProbe | null = null;

  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getSnapshot = () => this.lines.join("\n");
  private notify() { for (const listener of this.listeners) { try { listener(); } catch { /* diagnostic only */ } } }
  private add(line: string) { this.lines = [...this.lines.slice(-19), line]; this.notify(); }
  setReady(hasChannel: boolean) { if (!this.running && this.lines.length === 1 && ["READY", "NO_CHANNEL"].includes(this.lines[0])) { this.lines = [hasChannel ? "READY" : "NO_CHANNEL"]; this.structural = []; this.notify(); } }
  abort() { this.generation++; this.active?.cancel(); this.active = null; if (this.running) this.add("ABORTED"); this.running = false; }
  touch(stage: StalkerEpgTouchStage) { if (touchStages.has(stage)) this.add(stage); }

  press(channelAvailable: boolean, owner: StalkerEpgProbe | null, options: Parameters<StalkerEpgProbe["run"]>[0]) {
    if (this.running) { this.add("ALREADY_RUNNING"); return; }
    if (!channelAvailable) { this.add("NO_CHANNEL"); return; }
    if (!owner) { this.add("NO_PROBE_OWNER"); return; }
    this.lines = this.lines.filter((line) => touchStages.has(line)); this.structural = []; this.add("PRESSED"); // synchronous, before the probe's first await
    this.running = true;
    this.active = owner;
    const generation = ++this.generation;
    void owner.run({ ...options, observe: (event, details) => {
      if (this.generation === generation) this.observe(event, details);
    } }).finally(() => {
      if (this.generation === generation) { this.running = false; this.active = null; this.notify(); }
    });
  }

  observe(event: string, value: Record<string, unknown>) {
    const id = probeNumber(value.probeId);
    if (event === "BEGIN") this.add(`BEGIN auth=${yes(value.authenticatedAtStart)}`);
    if (event === "IDENTITY") this.add(value.hasPortalId === true ? "IDENTITY_OK" : "IDENTITY_NO_PORTAL_ID");
    if (event === "PROBE") this.add(`PROBE_${id}_REQUEST_CALLED`);
    if (event === "FETCH_DONE") this.add(`PROBE_${id}_FETCH_DONE ${count(value.fetchWaitMs)}ms`);
    if (event === "RESPONSE") {
      this.add(`PROBE_${id}_RESPONSE ${choice(value.dataShape, shapes)} items=${count(value.itemCount)} usable=${yes(value.usableShape)}`);
      this.structural.push(`dataShape=${choice(value.dataShape, shapes)} itemCount=${count(value.itemCount)} countScope=${value.countScope === "SAMPLED_GROUPS" ? "SAMPLED_GROUPS" : "EXACT"}`);
      this.structural.push(`responseHasChannelIdentity=${yes(value.responseHasChannelIdentity)} responseMatchesPortalId=${value.responseMatchesPortalId === "YES" || value.responseMatchesPortalId === "NO" ? value.responseMatchesPortalId : "UNKNOWN"}`);
      this.structural.push(`fieldNames=${Array.isArray(value.fieldNames) ? value.fieldNames.filter((f) => fields.has(f)).join(",") : ""} textShape=${choice(value.textShape, textShapes)}`);
    }
    if (event === "FIELDS") {
      const types = Array.isArray(value.fieldTypes) ? value.fieldTypes.flatMap((entry) => {
        if (!entry || typeof entry !== "object") return [];
        const row = entry as { field?: unknown; types?: unknown };
        return typeof row.field === "string" && fields.has(row.field) && Array.isArray(row.types) ? [`${row.field}:${row.types.filter((type) => typeof type === "string" && shapes.has(type)).join("|")}`] : [];
      }) : [];
      this.structural.push(`fieldTypes=${types.join(",")}`);
    }
    if (event === "TIME") {
      const samples = Array.isArray(value.samples) ? value.samples.flatMap((sample) => sample && typeof sample === "object" ? [sample as { kind?: unknown; magnitude?: unknown }] : []) : [];
      if (typeof value.field === "string" && fields.has(value.field)) this.structural.push(`timeShape.${value.field}=${samples.map((sample) => `${choice(sample.kind, kinds)}:${choice(sample.magnitude, magnitudes)}`).join(",")}`);
    }
    if (event === "ERROR") {
      const errorClass = choice(value.errorClass, classes);
      this.add(`PROBE_${id}_ERROR_${errorClass} http=${typeof value.httpStatus === "number" && value.httpStatus >= 100 && value.httpStatus <= 599 ? Math.floor(value.httpStatus) : "NOT_EXPOSED"} net=${networkEvidence(errorClass)}`);
    }
    if (event === "TIMEOUT") this.add("TIMEOUT_65S");
    if (event === "RESULT") {
      if (value.status === "SUPPORTED_SHAPE") this.add(`RESULT_SUPPORTED_${choice(value.capability, actions)}`);
      else if (value.status === "INCONCLUSIVE") this.add(`RESULT_INCONCLUSIVE_${choice(value.reason, reasons, value.capability === "get_short_epg" ? "get_short_epg" : "UNKNOWN")}`);
      else if (value.errorClass === "ABORT") this.add("ABORTED");
      else this.add(`RESULT_FAILED_${choice(value.errorClass, classes)}`);
    }
  }

  summary(version?: unknown, versionCode?: unknown, sha?: unknown) {
    const safeVersion = typeof version === "string" && /^\d+\.\d+\.\d+$/.test(version) ? version : "unknown";
    const safeCode = typeof versionCode === "number" && Number.isSafeInteger(versionCode) ? versionCode : "unknown";
    const safeSha = typeof sha === "string" && /^[a-f0-9]{7,12}$/i.test(sha) ? sha : "unavailable";
    return [`R18_E0P version=${safeVersion} versionCode=${safeCode} sha=${safeSha}`, ...this.lines, ...this.structural.slice(-30)].join("\n");
  }

  async copy(write: (content: string) => Promise<unknown>, version?: unknown, versionCode?: unknown, sha?: unknown): Promise<"KOPYALANDI" | "KOPYALAMA_BASARISIZ"> {
    try { await write(this.summary(version, versionCode, sha)); return "KOPYALANDI"; }
    catch { return "KOPYALAMA_BASARISIZ"; }
  }
}
