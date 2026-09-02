import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { formatCatalogSyncMeasurement } from "../lib/catalogSyncMetrics";
import { providerListPresentation } from "../lib/providerDisplaySecurity";
import {
  redactSensitiveText,
  sanitizeErrorForLog,
  sanitizeLogValue,
} from "../lib/safeLog";

type Scenario = { name: string; run: () => void };
const scenarios: Scenario[] = [];
const test = (name: string, run: () => void) => scenarios.push({ name, run });

test("URL is redacted while diagnostic context remains", () => {
  const value = redactSensitiveText(
    "Provider request failed at https://demo.example/live/user/pass/42.ts after timeout",
  );
  assert.equal(value, "Provider request failed at [REDACTED_URL] after timeout");
});

test("credential key-value pairs and authorization tokens are redacted", () => {
  const value = redactSensitiveText(
    "login failed username=alice password=hunter2 Authorization: Bearer abc.def.ghi retrying",
  );
  assert.match(value, /username=\[REDACTED\]/);
  assert.match(value, /password=\[REDACTED\]/);
  assert.doesNotMatch(value, /alice|hunter2|abc\.def\.ghi/);
  assert.match(value, /login failed/);
  assert.match(value, /retrying/);
});

test("quoted JSON credential fields are redacted without erasing the message", () => {
  const value = redactSensitiveText(
    'upstream rejected {"password":"secret","token":"token-value"} request',
  );
  assert.equal(
    value,
    'upstream rejected {"password":"[REDACTED]","token":"[REDACTED]"} request',
  );
});

test("MAC addresses are redacted", () => {
  const value = redactSensitiveText("device AA:BB:CC:DD:EE:FF rejected");
  assert.equal(value, "device [REDACTED_MAC] rejected");
});

test("release error preserves class and redacted message but omits stack", () => {
  const error = new TypeError(
    "Fetch https://example.test/player_api.php failed password=hunter2",
  );
  const value = sanitizeErrorForLog(error, { includeStack: false });
  assert.equal(value.name, "TypeError");
  assert.match(value.message, /^Fetch \[REDACTED_URL\] failed password=\[REDACTED\]$/);
  assert.equal("stack" in value, false);
});

test("diagnostic/dev error may keep a redacted stack", () => {
  const error = new Error("Request failed token=secret-token");
  error.stack = "Error: Request failed token=secret-token\n at https://example.test/private";
  const value = sanitizeErrorForLog(error, { includeStack: true });
  assert.ok(value.stack);
  assert.match(value.stack ?? "", /\[REDACTED\]/);
  assert.match(value.stack ?? "", /\[REDACTED_URL\]/);
  assert.doesNotMatch(value.stack ?? "", /secret-token|example\.test/);
});

test("structured log values redact sensitive fields recursively", () => {
  const value = sanitizeLogValue({
    status: "failed",
    username: "alice",
    nested: {
      password: "hunter2",
      streamUrl: "https://example.test/live/1",
      message: "retry https://example.test/private next",
    },
  }) as Record<string, any>;
  assert.equal(value.status, "failed");
  assert.equal(value.username, "[REDACTED]");
  assert.equal(value.nested.password, "[REDACTED]");
  assert.equal(value.nested.streamUrl, "[REDACTED]");
  assert.equal(value.nested.message, "retry [REDACTED_URL] next");
});

test("ordinary error text is retained rather than collapsed to a fixed code", () => {
  const error = new RangeError("Catalog cursor is outside the valid range");
  const value = sanitizeErrorForLog(error, { includeStack: false });
  assert.deepEqual(value, {
    name: "RangeError",
    message: "Catalog cursor is outside the valid range",
  });
});

test("catalog sync diagnostics output is strict K4 allowlist", () => {
  const output = formatCatalogSyncMeasurement({
    providerId: "https://demo.example/player_api.php?username=alice&password=hunter2&token=secret-token",
    providerName: "Secret Provider",
    baseUrl: "https://demo.example",
    username: "alice",
    password: "hunter2",
    token: "secret-token",
    credential: "username=alice password=hunter2",
    streamUrl: "https://demo.example/live/alice/hunter2/42.ts",
    mode: "manual",
    startedAt: 123,
    totalMs: 4500,
    liveSqliteWriteMs: 120,
    vod: {
      path: "bulk",
      itemCount: 22241,
      bulkParseMs: 310,
      sqliteWriteMs: 900,
      totalMs: 1800,
      parallelMaxObserved: 0,
    },
    series: {
      path: "parallel",
      itemCount: 4991,
      bulkParseMs: 80,
      sqliteWriteMs: 420,
      totalMs: 1600,
      parallelMaxObserved: 6,
      fallbackReason: "empty",
    },
  } as any);

  assert.match(output, /^mode=manual$/m);
  assert.match(output, /^totalMs=4500$/m);
  assert.match(output, /^liveSqliteWriteMs=120$/m);
  assert.match(output, /^vod\.path=bulk$/m);
  assert.match(output, /^vod\.bulkParseMs=310$/m);
  assert.match(output, /^vod\.sqliteWriteMs=900$/m);
  assert.match(output, /^vod\.totalMs=1800$/m);
  assert.match(output, /^vod\.itemCount=22241$/m);
  assert.match(output, /^vod\.parallelMaxObserved=0$/m);
  assert.match(output, /^vod\.fallbackReason=none$/m);
  assert.match(output, /^series\.path=parallel$/m);
  assert.match(output, /^series\.fallbackReason=empty$/m);

  assert.doesNotMatch(
    output,
    /provider(?:Id|Name)?|server|baseUrl|https?:\/\/|username|password|token|credential|streamUrl|alice|hunter2|secret-token|demo\.example/i,
  );
});

test("provider list presentation strips query string, scheme, port and path", () => {
  const output = providerListPresentation({
    type: "m3u",
    url: "https://electanextycsy1.xyz:8080/get.php?username=alice&password=hunter2&type=m3u_plus",
  });
  assert.equal(output.host, "electanextycsy1.xyz");
  assert.equal(output.maskedIdentifier, "al**e");
  assert.doesNotMatch(
    JSON.stringify(output),
    /https?:\/\/|:8080|get\.php|\?|username=|password=|type=|hunter2/i,
  );
});

test("provider list presentation never serializes password-shaped extra fields", () => {
  const output = providerListPresentation({
    type: "xtream",
    url: "https://tv.example.test/player_api.php?username=sample-user&password=NeverShowMe123",
    username: "sample-user",
    password: "NeverShowMe123",
    credential: "password=NeverShowMe123",
    streamUrl: "https://tv.example.test/live/sample-user/NeverShowMe123/1.ts",
  } as any);
  const rendered = JSON.stringify(output);
  assert.doesNotMatch(rendered, /NeverShowMe123|password|credential|streamUrl/i);
});

test("get.php source is represented only by host plus masked account identity", () => {
  const output = providerListPresentation({
    type: "m3u",
    playlistUrl: "http://iptv.example.org/get.php?username=ab12345z&password=p455&type=m3u_plus&output=ts",
  });
  assert.deepEqual(output, {
    host: "iptv.example.org",
    maskedIdentifier: "ab*****z",
    meta: "M3U · ab*****z",
  });
});

test("provider edit screen keeps editable URL and username with explicit password reveal", () => {
  const source = readFileSync("components/OptimizedHomeScreenPaged.tsx", "utf8");
  assert.match(source, /<Input label=\{t\("serverUrl"\)\} value=\{url\}/);
  assert.match(source, /<Input label=\{t\("username"\)\} value=\{username\}/);
  assert.match(source, /secureTextEntry=\{!passwordVisible\}/);
  assert.match(source, /setPasswordVisible\(\(value\) => !value\)/);
  assert.match(source, /name=\{passwordVisible \? "eye-off" : "eye"\}/);
});

const EXPECTED = 13;
if (scenarios.length !== EXPECTED) {
  throw new Error(`log redaction scenario registration mismatch: ${scenarios.length}/${EXPECTED}`);
}

let passed = 0;
for (const scenario of scenarios) {
  try {
    scenario.run();
    passed += 1;
    process.stdout.write(`PASS [log-security] ${scenario.name}\n`);
  } catch (error) {
    process.stderr.write(`FAIL [log-security] ${scenario.name}: ${error instanceof Error ? error.message : String(error)}\n`);
    throw error;
  }
}

if (passed !== EXPECTED) {
  throw new Error(`log redaction scenarios incomplete: ${passed}/${EXPECTED}`);
}
process.stdout.write(`log redaction scenarios: ${passed}/${EXPECTED} passed\n`);
