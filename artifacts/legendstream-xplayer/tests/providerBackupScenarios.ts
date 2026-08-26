import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import {
  assertSecureRecordFits,
  base64UrlDecode,
  base64UrlEncode,
  decryptBackupFile,
  encryptBackupPayload,
  generateRecoveryPhrase,
  MAX_SECURE_RECORD_BYTES,
  nobleCryptoRuntimeTypes,
  normalizeBackupPassword,
  ProviderBackupError,
  RECOVERY_ENTROPY_BITS,
  RECOVERY_REJECTION_LIMIT,
  RECOVERY_WORD_COUNT,
  RECOVERY_WORDLIST_SIZE,
  recoveryWordlistStats,
  sampleRecoveryWordIndex,
  secureRecordByteLength,
  type BackupPayloadV1,
  type SecureRandomBytes,
} from "../lib/providerBackupCore";
import { resolveImportTargets } from "../lib/providerBackupPlanning";

type Category = "acceptance" | "negativeCrypto" | "roundTrip" | "security";
type TestCase = { category: Category; name: string; run: () => void | Promise<void> };

const EXPECTED: Record<Category, number> = {
  acceptance: 7,
  negativeCrypto: 2,
  roundTrip: 1,
  security: 12,
};
const EXPECTED_TESTS = Object.values(EXPECTED).reduce((sum, count) => sum + count, 0);
const tests: TestCase[] = [];

function test(category: Category, name: string, run: TestCase["run"]) {
  tests.push({ category, name, run });
}

function seededRandom(seed: number): SecureRandomBytes {
  let state = seed >>> 0;
  return (length: number) => {
    const out = new Uint8Array(length);
    for (let i = 0; i < length; i += 1) {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      out[i] = state & 0xff;
    }
    return out;
  };
}

function payload(providers: BackupPayloadV1["providers"]): BackupPayloadV1 {
  return {
    schema_version: 1,
    exported_at: "2026-08-26T12:00:00.000Z",
    active_provider_id: providers[0]?.id,
    providers,
  };
}

const provider = {
  id: "provider-1",
  name: "Test Provider",
  type: "xtream" as const,
  createdAt: 1700000000000,
  connectedAt: "2026-08-01T10:00:00.000Z",
  credentials: {
    url: "https://provider.example",
    playlistUrl: "https://provider.example/get.php?username=user-secret&password=pass-secret",
    username: "user-secret",
    password: "pass-secret",
  },
  future_field: { preserved: true },
};
const fullPayload = payload([provider]);
const password = "secure-custom-password-123";

async function expectBackupError(
  promise: Promise<unknown>,
  code: ProviderBackupError["code"],
) {
  try {
    await promise;
    assert.fail(`expected ProviderBackupError(${code})`);
  } catch (error) {
    assert(error instanceof ProviderBackupError, `expected ProviderBackupError, got ${String(error)}`);
    assert.equal(error.code, code);
  }
}

function splitFile(bytes: Uint8Array) {
  const lf = bytes.indexOf(0x0a);
  assert(lf > 0);
  return {
    headerBytes: bytes.slice(0, lf),
    header: new TextDecoder().decode(bytes.slice(0, lf)),
    cipher: new TextDecoder().decode(bytes.slice(lf + 1)),
  };
}

function rebuildFile(headerBytes: Uint8Array, cipher: string) {
  const encodedCipher = new TextEncoder().encode(cipher);
  const out = new Uint8Array(headerBytes.length + 1 + encodedCipher.length);
  out.set(headerBytes, 0);
  out[headerBytes.length] = 0x0a;
  out.set(encodedCipher, headerBytes.length + 1);
  return out;
}

function changedByteCount(left: Uint8Array, right: Uint8Array) {
  assert.equal(left.length, right.length);
  let changed = 0;
  for (let i = 0; i < left.length; i += 1) if (left[i] !== right[i]) changed += 1;
  return changed;
}

async function authGateThenWrite(bytes: Uint8Array, backupPassword: string, onWrite: () => void) {
  const opened = await decryptBackupFile(bytes, backupPassword);
  onWrite();
  return opened;
}

test("acceptance", "correct password opens payload and preserves unknown fields", async () => {
  const encrypted = await encryptBackupPayload(fullPayload, password, seededRandom(1));
  assert.equal(encrypted.bytes.filter((byte) => byte === 0x0a).length, 1);
  assert.equal(new TextDecoder().decode(encrypted.bytes).includes("\r\n"), false);
  const opened = await decryptBackupFile(encrypted.bytes, password);
  assert.equal(opened.payload.providers.length, 1);
  assert.equal(opened.payload.providers[0].credentials.password, "pass-secret");
  assert.deepEqual(opened.payload.providers[0].future_field, { preserved: true });
});

test("acceptance", "wrong password is rejected before payload use", async () => {
  const encrypted = await encryptBackupPayload(fullPayload, password, seededRandom(2));
  await expectBackupError(decryptBackupFile(encrypted.bytes, "definitely-wrong-password"), "wrong_password");
});

test("acceptance", "ID conflicts resolve overwrite keep-both skip deterministically", () => {
  const targets = resolveImportTargets(
    ["overwrite-me", "keep-me", "skip-me", "new-one"],
    new Set(["overwrite-me", "keep-me", "skip-me"]),
    { "overwrite-me": "overwrite", "keep-me": "keep_both", "skip-me": "skip" },
    (() => { let counter = 0; return () => `generated-${++counter}`; })(),
  );
  assert.deepEqual(targets[0], { sourceId: "overwrite-me", targetId: "overwrite-me", overwrite: true, skipped: false });
  assert.equal(targets[1].targetId, "generated-1");
  assert.equal(targets[1].overwrite, false);
  assert.equal(targets[2].skipped, true);
  assert.equal(targets[2].targetId, null);
  assert.equal(targets[3].targetId, "new-one");
});

test("acceptance", "empty provider list round-trips as a valid encrypted no-op", async () => {
  const encrypted = await encryptBackupPayload(payload([]), password, seededRandom(3));
  assert.deepEqual((await decryptBackupFile(encrypted.bytes, password)).payload.providers, []);
});

test("acceptance", "backup is device independent", async () => {
  const file = await encryptBackupPayload(fullPayload, password, seededRandom(4));
  const opened = await decryptBackupFile(new Uint8Array(file.bytes), password);
  assert.equal(opened.payload.providers[0].id, "provider-1");
});

test("acceptance", "NFKC password normalization accepts canonically equivalent Unicode", async () => {
  const nfcPassword = "Cafe\u00e9-Backup-Phrase-2026";
  const nfdPassword = nfcPassword.normalize("NFD");
  assert.notEqual(new TextEncoder().encode(nfcPassword).join(","), new TextEncoder().encode(nfdPassword).join(","));
  assert.equal(normalizeBackupPassword(nfcPassword), normalizeBackupPassword(nfdPassword));
  const nfcFile = await encryptBackupPayload(fullPayload, nfcPassword, seededRandom(5));
  assert.equal((await decryptBackupFile(nfcFile.bytes, nfdPassword)).payload.providers[0].id, "provider-1");
});

test("acceptance", "entropy unavailable hard-fails with no fallback", async () => {
  await expectBackupError(encryptBackupPayload(fullPayload, password, undefined), "entropy_unavailable");
});

test("negativeCrypto", "single ciphertext byte mutation fails authentication and performs zero writes", async () => {
  const encrypted = await encryptBackupPayload(fullPayload, password, seededRandom(6));
  const parts = splitFile(encrypted.bytes);
  const decoded = base64UrlDecode(parts.cipher);
  const mutated = new Uint8Array(decoded);
  mutated[Math.min(7, mutated.length - 17)] ^= 0x01;
  assert.equal(changedByteCount(decoded, mutated), 1, "exactly one ciphertext byte must change");
  const tampered = rebuildFile(parts.headerBytes, base64UrlEncode(mutated));
  let writes = 0;
  await expectBackupError(authGateThenWrite(tampered, password, () => { writes += 1; }), "corrupt_file");
  assert.equal(writes, 0, "ciphertext auth failure must cause zero writes");
});

test("negativeCrypto", "single header byte mutation is rejected by AAD and performs zero writes", async () => {
  const encrypted = await encryptBackupPayload(fullPayload, password, seededRandom(7));
  const parts = splitFile(encrypted.bytes);
  const mutatedHeader = new Uint8Array(parts.headerBytes);
  const needle = new TextEncoder().encode("2026-08-26T12:00:00.000Z");
  let start = -1;
  outer: for (let i = 0; i <= mutatedHeader.length - needle.length; i += 1) {
    for (let j = 0; j < needle.length; j += 1) {
      if (mutatedHeader[i + j] !== needle[j]) continue outer;
    }
    start = i;
    break;
  }
  assert(start >= 0, "created_at anchor must exist in header");
  const byteIndex = start + "2026-08-26T12:00:0".length;
  assert.equal(mutatedHeader[byteIndex], 0x30);
  mutatedHeader[byteIndex] = 0x31;
  assert.equal(changedByteCount(parts.headerBytes, mutatedHeader), 1, "exactly one header byte must change");
  JSON.parse(new TextDecoder().decode(mutatedHeader));
  const tampered = rebuildFile(mutatedHeader, parts.cipher);
  let writes = 0;
  await expectBackupError(authGateThenWrite(tampered, password, () => { writes += 1; }), "corrupt_file");
  assert.equal(writes, 0, "AAD auth failure must cause zero writes");
});

test("roundTrip", "real credential export-import is byte-for-byte value identical including Unicode password", async () => {
  const credentials = {
    url: "https://iptv.example:8443",
    playlistUrl: "https://iptv.example:8443/get.php?username=muammer&password=opaque",
    epgUrl: "https://iptv.example:8443/xmltv.php?username=muammer&password=opaque",
    username: "muammer_İPTV",
    password: "Şifre-İstanbul-çığ-🔐-пароль-2026",
  };
  const realistic = payload([{
    id: "real-provider-1",
    name: "Ev IPTV",
    type: "xtream",
    createdAt: 1760000000000,
    connectedAt: "2026-08-26T14:00:00.000Z",
    lastLoadedAt: 1770000000000,
    channelCount: 18452,
    credentials,
  }]);
  const exported = await encryptBackupPayload(realistic, password, seededRandom(8));
  const imported = await decryptBackupFile(exported.bytes, password);
  assert.deepEqual(imported.payload.providers[0].credentials, credentials);
  assert.equal(imported.payload.providers[0].credentials.password, credentials.password);
  assert.equal(new TextEncoder().encode(imported.payload.providers[0].credentials.password as string).join(","), new TextEncoder().encode(credentials.password).join(","));
});

test("security", "all Noble crypto runtime exports are callable", () => {
  const types = nobleCryptoRuntimeTypes();
  console.log(`noble runtime types: ${JSON.stringify(types)}`);
  assert.deepEqual(types, {
    gcm: "function",
    hkdf: "function",
    hmac: "function",
    scryptAsync: "function",
    sha256: "function",
  });
});

test("security", "degraded Noble runtime loads without throw and blocks crypto before writes", () => {
  const loader = resolve(process.cwd(), "tests/providerBackupDegradedLoader.cjs");
  const scenario = resolve(process.cwd(), "tests/providerBackupDegradedMode.ts");
  const child = spawnSync(
    process.execPath,
    ["--no-warnings", "--require", loader, "--import", "tsx", scenario],
    { cwd: process.cwd(), encoding: "utf8", env: { ...process.env } },
  );

  assert.equal(
    child.status,
    0,
    `degraded-mode child failed (status=${String(child.status)})\nstdout:\n${child.stdout}\nstderr:\n${child.stderr}`,
  );
  assert.match(
    child.stdout,
    /degraded-mode: module-load=pass cryptoAvailable=false secureStoreWrites=0 asyncStorageWrites=0/u,
  );
});

test("security", "EFF recovery wordlist has exactly 7776 unique lowercase ASCII words", () => {
  const stats = recoveryWordlistStats();
  assert.equal(stats.source, "EFF Large Wordlist for Passphrases (2016-07-18)");
  assert.equal(stats.actualWordCount, 7776);
  assert.equal(stats.uniqueWordCount, 7776);
  assert.equal(stats.asciiLowercase, true);
  assert.equal(RECOVERY_WORDLIST_SIZE, 7776);
});

test("security", "six EFF words provide about 77.55 bits with replacement", () => {
  assert.equal(RECOVERY_WORD_COUNT, 6);
  const expected = Math.log2(7776) * 6;
  assert(Math.abs(RECOVERY_ENTROPY_BITS - expected) < 1e-12);
  assert(RECOVERY_ENTROPY_BITS > 77.54 && RECOVERY_ENTROPY_BITS < 77.56);
});

test("security", "recovery word index uses rejection sampling before modulo", () => {
  assert.equal(RECOVERY_REJECTION_LIMIT, 62208);
  let calls = 0;
  const random: SecureRandomBytes = (length) => {
    assert.equal(length, 2);
    calls += 1;
    return calls === 1 ? Uint8Array.of(0xf3, 0x00) : Uint8Array.of(0xf2, 0xff);
  };
  assert.equal(sampleRecoveryWordIndex(random), 7775);
  assert.equal(calls, 2, "candidate equal to rejection limit must be discarded");
});

test("security", "recovery generation samples with replacement and permits repeated words", () => {
  const random: SecureRandomBytes = (length) => {
    assert.equal(length, 2);
    return Uint8Array.of(0x00, 0x00);
  };
  const words = generateRecoveryPhrase(random).split(" ");
  assert.equal(words.length, 6);
  assert.equal(new Set(words).size, 1, "duplicate words must not be suppressed");
});

test("security", "generated EFF recovery phrase is six space-separated ASCII lowercase words", () => {
  const phrase = generateRecoveryPhrase(seededRandom(9));
  const words = phrase.split(" ");
  assert.equal(words.length, 6);
  for (const word of words) assert.match(word, /^[a-z]+(?:-[a-z]+)*$/u);
});

test("security", "legacy synthetic recovery phrases remain valid opaque backup passwords", async () => {
  const legacyPhrase = "banban-banbar-banben-banber-bandin-bandir";
  const encrypted = await encryptBackupPayload(fullPayload, legacyPhrase, seededRandom(13));
  const opened = await decryptBackupFile(encrypted.bytes, legacyPhrase);
  assert.equal(opened.payload.providers[0].id, "provider-1");
});

test("security", "hostile KDF work factors are rejected before scrypt", async () => {
  const encrypted = await encryptBackupPayload(fullPayload, password, seededRandom(10));
  const parts = splitFile(encrypted.bytes);
  const header = JSON.parse(parts.header) as { kdf: { N: number } } & Record<string, unknown>;
  header.kdf.N = 2 ** 20;
  await expectBackupError(decryptBackupFile(rebuildFile(new TextEncoder().encode(JSON.stringify(header)), parts.cipher), password), "kdf_bounds");
});

test("security", "newer schema is rejected", async () => {
  const encrypted = await encryptBackupPayload(fullPayload, password, seededRandom(11));
  const parts = splitFile(encrypted.bytes);
  const header = JSON.parse(parts.header) as Record<string, unknown>;
  header.schema_version = 2;
  await expectBackupError(decryptBackupFile(rebuildFile(new TextEncoder().encode(JSON.stringify(header)), parts.cipher), password), "unsupported_version");
});

test("security", "secure storage portability preflight is byte bounded", () => {
  const fitting = { value: "x".repeat(1800) };
  assert(secureRecordByteLength(fitting) <= MAX_SECURE_RECORD_BYTES);
  assert.doesNotThrow(() => assertSecureRecordFits(fitting));
  const oversized = { value: "x".repeat(MAX_SECURE_RECORD_BYTES + 1) };
  assert.throws(() => assertSecureRecordFits(oversized), (error) => error instanceof ProviderBackupError && error.code === "secure_record_too_large");
});

test("security", "encrypted artifact exposes no credential values in cleartext", async () => {
  const encrypted = await encryptBackupPayload(fullPayload, password, seededRandom(12));
  const encryptedText = new TextDecoder().decode(encrypted.bytes);
  for (const secret of ["user-secret", "pass-secret", "https://provider.example"]) {
    assert.equal(encryptedText.includes(secret), false, `encrypted file leaked ${secret}`);
  }
});

async function main() {
  assert.equal(tests.length, EXPECTED_TESTS, `registered test count ${tests.length} != expected ${EXPECTED_TESTS}`);
  const registeredByCategory: Record<Category, number> = { acceptance: 0, negativeCrypto: 0, roundTrip: 0, security: 0 };
  for (const item of tests) registeredByCategory[item.category] += 1;
  for (const category of Object.keys(EXPECTED) as Category[]) {
    assert.equal(registeredByCategory[category], EXPECTED[category], `${category} registered ${registeredByCategory[category]} != expected ${EXPECTED[category]}`);
  }

  const passedByCategory: Record<Category, number> = { acceptance: 0, negativeCrypto: 0, roundTrip: 0, security: 0 };
  let passed = 0;
  for (const item of tests) {
    try {
      await item.run();
      passed += 1;
      passedByCategory[item.category] += 1;
      console.log(`PASS [${item.category}] ${item.name}`);
    } catch (error) {
      console.error(`FAIL [${item.category}] ${item.name}`);
      throw error;
    }
  }

  assert.equal(passed, EXPECTED_TESTS, `only ${passed}/${EXPECTED_TESTS} tests executed successfully`);
  for (const category of Object.keys(EXPECTED) as Category[]) {
    assert.equal(passedByCategory[category], EXPECTED[category], `${category}: only ${passedByCategory[category]}/${EXPECTED[category]} passed`);
  }
  console.log(`provider backup acceptance: ${passedByCategory.acceptance}/${EXPECTED.acceptance} passed`);
  console.log(`negative crypto: ${passedByCategory.negativeCrypto}/${EXPECTED.negativeCrypto} passed`);
  console.log(`credential round-trip: ${passedByCategory.roundTrip}/${EXPECTED.roundTrip} passed`);
  console.log(`security regressions: ${passedByCategory.security}/${EXPECTED.security} passed`);
  console.log(`provider backup tests: ${passed}/${EXPECTED_TESTS} passed`);
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : "provider backup tests failed");
  process.exitCode = 1;
});