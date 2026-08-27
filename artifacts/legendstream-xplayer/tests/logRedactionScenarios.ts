import assert from "node:assert/strict";
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

const EXPECTED = 8;
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
