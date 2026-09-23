import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { OwnedEpgAttempts } from "../lib/ownedEpgAttempt";
import {
  getXtreamEpgDiagnosticSnapshot, invalidateXtreamEpgDiagnosticAttempt,
  recordXtreamEpgCpuStage, recordXtreamEpgFailure, recordXtreamEpgParseYield,
  resetXtreamEpgDiagnosticRun,
  setXtreamEpgSourceKind,
} from "../lib/xtreamEpgDiagnostics";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const context = readFileSync(resolve(root, "context/PlayerContext.tsx"), "utf8");
const iptv = readFileSync(resolve(root, "lib/iptv.ts"), "utf8");
const names = new Set(["EpgPhaseFailure", "epgRequestDeadline", "httpEpgFailure"]);
const parsed = ts.createSourceFile("iptv.ts", iptv, ts.ScriptTarget.ES2020, true);
const selected = parsed.statements.filter((node) =>
  (ts.isClassDeclaration(node) || ts.isFunctionDeclaration(node)) && node.name && names.has(node.name.text),
);
assert.equal(selected.length, 3);
const source = selected.map((node) => node.getText(parsed).replace(/^export\s+/, "")).join("\n");
const javascript = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None },
}).outputText;
const loadDeclaration = parsed.statements.find((node) =>
  ts.isFunctionDeclaration(node) && node.name?.text === "loadEpg",
);
assert.ok(loadDeclaration);
const limits = parsed.statements.filter((node) => ts.isVariableStatement(node) &&
  node.declarationList.declarations.some((declaration) => ts.isIdentifier(declaration.name) &&
    (declaration.name.text.endsWith("EPG_NETWORK_TIMEOUT_MS") ||
      declaration.name.text.endsWith("EPG_BODY_TIMEOUT_MS"))));
assert.equal(limits.length, 4);
const loadJavascript = ts.transpileModule(
  source + "\n" + limits.map((node) => node.getText(parsed).replace(/^export\s+/, "")).join("\n") +
  "\n" + loadDeclaration.getText(parsed).replace(/^export\s+/, ""),
  { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None } },
).outputText;
const { epgRequestDeadline, httpEpgFailure } = new Function(
  `${javascript}\nreturn { epgRequestDeadline, httpEpgFailure };`,
)() as {
  epgRequestDeadline: (parent?: AbortSignal) => {
    signal: AbortSignal;
    run<T>(stage: "request" | "body", ms: number, task: () => Promise<T>): Promise<T>;
    close(): void;
  };
  httpEpgFailure: (status: number) => Error & { stage: string; failureClass: string; httpStatusClass: string };
};

const previousSetTimeout = globalThis.setTimeout;
const previousClearTimeout = globalThis.clearTimeout;
const timers = new Map<number, { at: number; callback: () => void }>();
let clock = 0;
let nextTimer = 0;
globalThis.setTimeout = ((handler: () => void, ms: number) => {
  const id = ++nextTimer;
  timers.set(id, { at: clock + ms, callback: handler });
  return id;
}) as typeof setTimeout;
globalThis.clearTimeout = ((id: number) => { timers.delete(id); }) as typeof clearTimeout;
const advance = (durationMs: number) => {
  clock += durationMs;
  for (const [id, timer] of timers) {
    if (timer.at > clock) continue;
    timers.delete(id);
    timer.callback();
  }
};

async function main() {
  try {
    const owner = new OwnedEpgAttempts();
    const first = owner.begin("a", 1);
    const second = owner.begin("a", 2);
    assert.equal(first.controller.signal.aborted, true);
    assert.equal(owner.isCurrent(first), false);
    assert.equal(owner.isCurrent(second), true);
    owner.complete(first);
    assert.equal(owner.isCurrent(second), true);
    owner.cancel("a");
    assert.equal(second.controller.signal.aborted, true);
    assert.equal(owner.active("a"), undefined);
    const old = owner.begin("old-provider", 3);
    const cache = new Map<string, string>();
    owner.cancel("old-provider");
    const replacement = owner.begin("new-provider", 4);
    if (owner.isCurrent(old)) cache.set("old-provider", "late EPG");
    assert.equal(cache.has("old-provider"), false);
    assert.equal(owner.isCurrent(replacement), true);

    const oldDiagnostic = resetXtreamEpgDiagnosticRun(48);
    const newDiagnostic = resetXtreamEpgDiagnosticRun(12);
    setXtreamEpgSourceKind("xmltv", oldDiagnostic);
    recordXtreamEpgFailure("request", "network", "unknown", "none", false, oldDiagnostic);
    recordXtreamEpgCpuStage("XML_SCAN", 100, 100, 1, oldDiagnostic);
    recordXtreamEpgParseYield(oldDiagnostic);
    assert.equal(getXtreamEpgDiagnosticSnapshot().sourceKind, "unknown");
    assert.equal(getXtreamEpgDiagnosticSnapshot().failureClass, "—");
    assert.equal(getXtreamEpgDiagnosticSnapshot().cpu.XML_SCAN.workUnits, 0);
    assert.equal(getXtreamEpgDiagnosticSnapshot().parseYieldCount, 0);
    invalidateXtreamEpgDiagnosticAttempt(oldDiagnostic);
    assert.equal(getXtreamEpgDiagnosticSnapshot().attemptId, newDiagnostic);
    invalidateXtreamEpgDiagnosticAttempt(newDiagnostic);
    assert.equal(getXtreamEpgDiagnosticSnapshot().channelCount, 0);
    assert.equal(getXtreamEpgDiagnosticSnapshot().phases.BODY.elapsedMs, null);
    assert.equal(getXtreamEpgDiagnosticSnapshot().phases.PARSE.elapsedMs, null);

    let resolveRequest!: (value: string) => void;
    const request = new Promise<string>((resolve) => { resolveRequest = resolve; });
    const healthy = epgRequestDeadline();
    const healthyResult = healthy.run("request", 12_000, () => request);
    await Promise.resolve();
    advance(6_000); // Exceeds the old total-work deadline; this phase remains alive.
    assert.equal(healthy.signal.aborted, false);
    resolveRequest("headers");
    assert.equal(await healthyResult, "headers");
    assert.equal(healthy.signal.aborted, false);
    assert.equal(await healthy.run("body", 12_000, async () => "body"), "body");
    healthy.close();

    const hung = epgRequestDeadline();
    const hanging = hung.run("request", 12_000, () => new Promise<never>(() => undefined));
    await Promise.resolve();
    advance(12_000);
    await assert.rejects(hanging, (error: unknown) =>
      typeof error === "object" && error !== null &&
      "failureClass" in error && error.failureClass === "timeout" &&
      "stage" in error && error.stage === "request");
    assert.equal(hung.signal.aborted, true);
    hung.close();
    const stalledBody = epgRequestDeadline();
    const bodyWait = stalledBody.run("body", 30_000, () => new Promise<never>(() => undefined));
    await Promise.resolve();
    advance(30_000);
    await assert.rejects(bodyWait, (error: unknown) =>
      typeof error === "object" && error !== null &&
      "stage" in error && error.stage === "body" &&
      "failureClass" in error && error.failureClass === "timeout");
    assert.equal(stalledBody.signal.aborted, true);
    stalledBody.close();

    const parent = new AbortController();
    const switched = epgRequestDeadline(parent.signal);
    const pending = switched.run("body", 30_000, () => new Promise<never>(() => undefined));
    await Promise.resolve();
    parent.abort();
    await assert.rejects(pending, (error: unknown) =>
      typeof error === "object" && error !== null &&
      "failureClass" in error && error.failureClass === "abort");
    switched.close();

    const http = httpEpgFailure(503);
    assert.deepEqual([http.stage, http.failureClass, http.httpStatusClass], ["response", "http", "5xx"]);
    assert.doesNotMatch(http.message, /https?:|username|password|token|xmltv\.php/i);

    let mode = "FETCH_ONLY";
    let status = 503;
    let bodyReads = 0;
    const environment = {
      fetch: async () => ({ ok: status === 200, status,
        arrayBuffer: async () => { bodyReads += 1; return new ArrayBuffer(0); },
        text: async () => { bodyReads += 1; return JSON.stringify({ epg_listings: [
          { id: 7, title: "Programme", start_timestamp: 1, stop_timestamp: 2 },
        ] }); },
      }),
      getXtreamEpgDiagnosticSnapshot: () => ({ mode }),
      setXtreamEpgSourceKind: () => undefined,
      beginXtreamEpgPhase: () => undefined,
      endXtreamEpgPhase: () => undefined,
      recordXtreamEpgHeadersReceived: () => undefined,
      recordXtreamEpgFailure: () => undefined,
      cleanBaseUrl: (url: string) => url,
      decodeEpgText: (value: string) => value,
      atobUtf8Safe: (value: string) => value,
      decodeResponseText: async () => { bodyReads += 1; return "<tv/>"; },
      parseXmltvAsync: async () => [{ id: "xml", channelId: "c", start: 1, end: 2 }],
    };
    const loadEpg = new Function("environment",
      `with (environment) { ${loadJavascript}\nreturn loadEpg; }`,
    )(environment) as (provider: object, channels: object[], options?: object) => Promise<unknown[]>;
    const xmlProvider = { type: "xtream", epgUrl: "https://example.invalid/xmltv.php" };
    await assert.rejects(loadEpg(xmlProvider, [], { diagnosticAttemptId: 1 }),
      (error: unknown) => typeof error === "object" && error !== null &&
        "stage" in error && error.stage === "response" &&
        "httpStatusClass" in error && error.httpStatusClass === "5xx");
    assert.equal(bodyReads, 0);
    status = 200;
    await loadEpg(xmlProvider, [], { diagnosticAttemptId: 2 });
    assert.equal(bodyReads, 0, "FETCH_ONLY never reads the XML body");
    mode = "FULL_PIPELINE";
    assert.equal((await loadEpg(xmlProvider, [], { diagnosticAttemptId: 3 })).length, 1);
    assert.equal(bodyReads, 1);
    const shortProvider = { type: "xtream", url: "https://example.invalid", username: "test", password: "test" };
    const shortChannels = [{ streamType: "xtream", id: "p:xtream-live:1" }];
    mode = "FETCH_ONLY";
    status = 503;
    await assert.rejects(loadEpg(shortProvider, shortChannels),
      (error: unknown) => typeof error === "object" && error !== null &&
        "failureClass" in error && error.failureClass === "http");
    assert.equal(bodyReads, 1);
    status = 200;
    await loadEpg(shortProvider, shortChannels);
    assert.equal(bodyReads, 1);
    mode = "FULL_PIPELINE";
    assert.equal((await loadEpg(shortProvider, shortChannels)).length, 1);
    assert.equal(bodyReads, 2);

    assert.match(iptv, /if \(!response\.ok\) throw diagnosticXtream[\s\S]*?if \(diagnosticXtream && mode === "FETCH_ONLY"\) return \[\]/);
    assert.match(iptv, /if \(!response\.ok\) throw httpEpgFailure\(response\.status\);[\s\S]*?if \(mode === "FETCH_ONLY"\) return \[\]/);
    assert.match(context, /const stopBeforeNormalization = diagnosticMode === "FETCH_ONLY" \|\| diagnosticMode === "FETCH_BODY_ONLY"/);
    assert.match(context, /return stopBeforeNormalization \? programs :[\s\S]*?normalizeProgramText/);
    assert.match(context, /if \(!isOwned\(\)\) return;\s*epgCacheRef\.current\.set/);
    assert.match(context, /cancelOwnedEpg\(previousId\)/);
    assert.doesNotMatch(context, /EPG_BACKGROUND_BUDGET_MS/);
    assert.match(context, /loadBulkProviderEpg\(provider, providerChannels,[\s\S]*ownedAttempt\?\.controller\.signal, diagnosticAttemptId/);
    process.stdout.write(`owned EPG lifecycle scenarios: PASS (${clock}ms simulated, no real delay)\n`);
  } finally {
    globalThis.setTimeout = previousSetTimeout;
    globalThis.clearTimeout = previousClearTimeout;
  }
}

void main().catch((error) => { process.stderr.write(String(error)); process.exitCode = 1; });
