import assert from "node:assert/strict";
import { redactServerLogText, serializeServerLogError } from "./logRedaction";

type Scenario = { name: string; run: () => void };
const scenarios: Scenario[] = [];
const test = (name: string, run: () => void) => scenarios.push({ name, run });

test("server error text retains context while URL and credentials are redacted", () => {
  const value = redactServerLogText(
    "upstream https://example.test/player_api.php failed username=alice password=hunter2 retry",
  );
  assert.equal(
    value,
    "upstream [REDACTED_URL] failed username=[REDACTED] password=[REDACTED] retry",
  );
});

test("production serializer keeps class/message and omits stack", () => {
  const error = new TypeError("provider failed token=abc123");
  const value = serializeServerLogError(error, { includeStack: false });
  assert.deepEqual(value, {
    type: "TypeError",
    message: "provider failed token=[REDACTED]",
  });
});

test("development serializer keeps only a redacted stack", () => {
  const error = new Error("request failed password=hidden");
  error.stack = "Error: request failed password=hidden\n at https://example.test/private";
  const value = serializeServerLogError(error, { includeStack: true });
  assert.ok(value.stack);
  assert.doesNotMatch(value.stack ?? "", /hidden|example\.test/);
  assert.match(value.stack ?? "", /\[REDACTED\]/);
  assert.match(value.stack ?? "", /\[REDACTED_URL\]/);
});

test("ordinary server error messages are not collapsed to generic codes", () => {
  const error = new RangeError("Port value is outside the accepted range");
  const value = serializeServerLogError(error, { includeStack: false });
  assert.deepEqual(value, {
    type: "RangeError",
    message: "Port value is outside the accepted range",
  });
});

const EXPECTED = 4;
if (scenarios.length !== EXPECTED) {
  throw new Error(`API log redaction scenario registration mismatch: ${scenarios.length}/${EXPECTED}`);
}

let passed = 0;
for (const scenario of scenarios) {
  scenario.run();
  passed += 1;
  process.stdout.write(`PASS [api-log-security] ${scenario.name}\n`);
}
if (passed !== EXPECTED) {
  throw new Error(`API log redaction scenarios incomplete: ${passed}/${EXPECTED}`);
}
process.stdout.write(`API log redaction scenarios: ${passed}/${EXPECTED} passed\n`);
