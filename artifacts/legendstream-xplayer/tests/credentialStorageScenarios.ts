import {
  credentialFieldsEqual,
  migratedLegacyStateAfterVerification,
  resolveCredentialState,
  type CredentialFields,
} from "../lib/providerCredentialState";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const full: CredentialFields = {
  url: "https://example.invalid",
  playlistUrl: "https://example.invalid/get.php",
  username: "user",
  password: "pass",
};

// 1) only v3: metadata-only v3 + current SecureStore record.
const onlyV3 = resolveCredentialState("xtream", undefined, undefined, {
  status: "found",
  secrets: full,
});
assert(!onlyV3.needsCredentials, "only-v3 should hydrate from SecureStore");
assert(!onlyV3.shouldWriteSecureStore, "only-v3 should not rewrite verified current secrets");

// 2) only v2: legacy plaintext can seed current storage, but only through
// saveCredentials which performs write/read-back verification.
const onlyV2 = resolveCredentialState("xtream", undefined, full, { status: "missing" });
assert(!onlyV2.needsCredentials, "only-v2 should be complete");
assert(onlyV2.shouldWriteSecureStore, "only-v2 should request verified SecureStore write");

// 3) v3 + v2: merge complementary fields by provider id.
const mixed = resolveCredentialState(
  "xtream",
  { username: "user", password: "pass" },
  { url: "https://example.invalid", playlistUrl: "https://example.invalid/get.php" },
  { status: "missing" },
);
assert(!mixed.needsCredentials, "v3+v2 should merge field-by-field");
assert(mixed.shouldWriteSecureStore, "v3+v2 should persist merged credentials after verification");

// 4) SecureStore throw: an access error is never treated as a miss and
// must not trigger a destructive/blank rewrite.
const secureThrow = resolveCredentialState("xtream", undefined, full, {
  status: "error",
  error: new Error("simulated SecureStore failure"),
});
assert(secureThrow.needsCredentials, "SecureStore error must require explicit attention");
assert(!secureThrow.shouldWriteSecureStore, "SecureStore error must not trigger rewrite");

// 5) partial fields: incomplete Xtream credentials stay marked missing.
const partial = resolveCredentialState(
  "xtream",
  { url: "https://example.invalid", username: "user" },
  undefined,
  { status: "missing" },
);
assert(partial.needsCredentials, "partial credentials must be marked incomplete");
assert(!partial.shouldWriteSecureStore, "partial credentials must never be persisted as complete");

assert(credentialFieldsEqual(full, { ...full }), "read-back equality helper should accept exact payload");
assert(!credentialFieldsEqual(full, { ...full, password: "different" }), "read-back equality helper should reject mismatch");

// 6) successful read-back authorizes a metadata-only v2 rewrite.
const legacyBefore = {
  providers: [{
    id: "legacy-1", name: "Legacy account", type: "xtream",
    url: "https://example.invalid",
    playlistUrl: "https://example.invalid/get.php?username=user&password=pass",
    epgUrl: "https://example.invalid/xmltv.php?username=user&password=pass",
    username: "user", password: "pass", mac: "00:11:22:33:44:55", createdAt: 1,
  }],
  provider: {
    id: "legacy-1", name: "Legacy account", type: "xtream",
    url: "https://example.invalid", username: "user", password: "pass",
  },
  activeProviderId: "legacy-1",
  favorites: ["fav"],
  history: ["recent"],
  channels: [{ streamUrl: "https://example.invalid/live/user/pass/1.ts" }],
};
assert(
  migratedLegacyStateAfterVerification(legacyBefore, false) === null,
  "failed/unverified read-back must not rewrite v2",
);
const legacyAfter = migratedLegacyStateAfterVerification(legacyBefore, true);
assert(legacyAfter !== null, "verified read-back should keep a v2 metadata record");
assert(legacyAfter.migrated === true, "v2 record must be marked migrated");
assert(!("channels" in legacyAfter), "credential-bearing channel URLs must not remain in v2");
const migratedProvider = (legacyAfter.providers as Array<Record<string, unknown>>)[0];
assert(migratedProvider.id === "legacy-1", "provider metadata must remain");
for (const key of ["url", "playlistUrl", "epgUrl", "username", "password", "mac"]) {
  assert(!(key in migratedProvider), `v2 credential field ${key} must be removed`);
}
const migratedActive = legacyAfter.provider as Record<string, unknown>;
assert(migratedActive.id === "legacy-1", "active provider metadata must remain");
assert(!("password" in migratedActive), "active provider plaintext password must be removed");

console.log("credential storage scenarios: 6/6 passed");
