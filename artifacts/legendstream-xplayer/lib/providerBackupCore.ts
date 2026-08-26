import { gcm } from "@noble/ciphers/aes.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { hmac } from "@noble/hashes/hmac.js";
import { scryptAsync } from "@noble/hashes/scrypt.js";
import { sha256 } from "@noble/hashes/sha2.js";

const NOBLE_CRYPTO_RUNTIME = { gcm, hkdf, hmac, scryptAsync, sha256 } as const;

export function nobleCryptoRuntimeTypes(): Record<keyof typeof NOBLE_CRYPTO_RUNTIME, string> {
  return Object.fromEntries(
    Object.entries(NOBLE_CRYPTO_RUNTIME).map(([name, value]) => [name, typeof value]),
  ) as Record<keyof typeof NOBLE_CRYPTO_RUNTIME, string>;
}

export function assertNobleCryptoRuntime(): void {
  const unavailable = Object.entries(NOBLE_CRYPTO_RUNTIME)
    .filter(([, value]) => typeof value !== "function")
    .map(([name, value]) => `${name}:${typeof value}`);
  if (unavailable.length) {
    throw new Error(`Noble crypto runtime exports unavailable: ${unavailable.join(", ")}`);
  }
}

assertNobleCryptoRuntime();

export const BACKUP_FORMAT = "legendstream_provider_backup" as const;
export const BACKUP_FORMAT_VERSION = 1 as const;
export const BACKUP_SCHEMA_VERSION = 1 as const;
export const PASSWORD_NORMALIZATION = "nfkc" as const;
export const MAX_SECURE_RECORD_BYTES = 1900;
export const MAX_BACKUP_FILE_BYTES = 2 * 1024 * 1024;

export const SCRYPT_WRITER_PROFILE = {
  name: "scrypt" as const,
  profile: "scrypt-v1-mobile" as const,
  N: 2 ** 15,
  r: 8,
  p: 3,
  dk_len: 32,
};

const SCRYPT_ASYNC_TICK_MS = 8;
const SCRYPT_MAXMEM = 160 * 1024 * 1024;
const PASSWORD_CHECK_DOMAIN = "LegendStream Backup Password Check v1";
const HKDF_ENCRYPTION_INFO = "LegendStream Backup Encryption Key v1";
const HKDF_CHECK_INFO = "LegendStream Backup Password Check Key v1";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export type ProviderBackupErrorCode =
  | "entropy_unavailable"
  | "password_required"
  | "password_too_long"
  | "weak_password"
  | "invalid_file"
  | "unsupported_version"
  | "kdf_bounds"
  | "wrong_password"
  | "corrupt_file"
  | "invalid_payload"
  | "secure_record_too_large";

export class ProviderBackupError extends Error {
  constructor(
    public readonly code: ProviderBackupErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ProviderBackupError";
  }
}

export type BackupCredentialRecord = Record<string, unknown> & {
  url?: string;
  playlistUrl?: string;
  epgUrl?: string;
  username?: string;
  password?: string;
  mac?: string;
};

export type BackupProviderRecord = Record<string, unknown> & {
  id: string;
  name: string;
  type: "xtream" | "m3u" | "stalker";
  createdAt: number;
  connectedAt?: string;
  lastLoadedAt?: number;
  channelCount?: number;
  credentials: BackupCredentialRecord;
};

export type BackupPayloadV1 = Record<string, unknown> & {
  schema_version: 1;
  exported_at: string;
  active_provider_id?: string;
  providers: BackupProviderRecord[];
};

export type BackupHeaderV1 = {
  format: typeof BACKUP_FORMAT;
  format_version: 1;
  schema_version: 1;
  created_at: string;
  password_normalization: typeof PASSWORD_NORMALIZATION;
  kdf: {
    name: "scrypt";
    profile?: string;
    salt: string;
    N: number;
    r: number;
    p: number;
    dk_len: number;
  };
  key_schedule: { name: "hkdf-sha256"; version: 1 };
  cipher: { name: "aes-256-gcm"; iv: string };
  password_check: string;
  payload_encoding: "utf8-json";
};

export type BackupKdfProgress = (progress: number) => void;
export type SecureRandomBytes = (length: number) => Uint8Array;

export type EncryptedBackupResult = {
  bytes: Uint8Array;
  kdfMs: number;
};

export type DecryptedBackupResult = {
  payload: BackupPayloadV1;
  header: BackupHeaderV1;
  kdfMs: number;
};

function concatBytes(...parts: Uint8Array[]) {
  const length = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function equalBytesConstantTime(left: Uint8Array, right: Uint8Array): boolean {
  let difference = left.length ^ right.length;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left[index] ^ (right[index] ?? 0);
  }
  return difference === 0;
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

export function base64UrlEncode(bytes: Uint8Array): string {
  let result = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    const triple = (a << 16) | (b << 8) | c;
    result += B64[(triple >>> 18) & 63];
    result += B64[(triple >>> 12) & 63];
    result += i + 1 < bytes.length ? B64[(triple >>> 6) & 63] : "=";
    result += i + 2 < bytes.length ? B64[triple & 63] : "=";
  }
  return result.replace(/=+$/u, "").replace(/\+/gu, "-").replace(/\//gu, "_");
}

export function base64UrlDecode(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/u.test(value)) {
    throw new ProviderBackupError("invalid_file", "Backup contains invalid base64url data.");
  }
  const normalized = value.replace(/-/gu, "+").replace(/_/gu, "/");
  const padding = normalized.length % 4 ? "=".repeat(4 - (normalized.length % 4)) : "";
  const input = normalized + padding;
  if (input.length % 4 !== 0) {
    throw new ProviderBackupError("invalid_file", "Backup contains invalid base64url data.");
  }
  const reverse = new Map(Array.from(B64, (character, index) => [character, index]));
  const out: number[] = [];
  for (let i = 0; i < input.length; i += 4) {
    const c0 = reverse.get(input[i]);
    const c1 = reverse.get(input[i + 1]);
    const c2 = input[i + 2] === "=" ? 0 : reverse.get(input[i + 2]);
    const c3 = input[i + 3] === "=" ? 0 : reverse.get(input[i + 3]);
    if (c0 === undefined || c1 === undefined || c2 === undefined || c3 === undefined) {
      throw new ProviderBackupError("invalid_file", "Backup contains invalid base64url data.");
    }
    const triple = (c0 << 18) | (c1 << 12) | (c2 << 6) | c3;
    out.push((triple >>> 16) & 255);
    if (input[i + 2] !== "=") out.push((triple >>> 8) & 255);
    if (input[i + 3] !== "=") out.push(triple & 255);
  }
  return Uint8Array.from(out);
}

export function utf8ByteLength(value: string): number {
  return encoder.encode(value).length;
}

export function normalizeBackupPassword(password: string): string {
  const normalized = password.normalize("NFKC");
  const bytes = encoder.encode(normalized);
  if (!bytes.length) {
    throw new ProviderBackupError("password_required", "A backup password is required.");
  }
  if (bytes.length > 256) {
    throw new ProviderBackupError("password_too_long", "Backup password exceeds 256 UTF-8 bytes.");
  }
  return normalized;
}

export function validateCustomBackupPassword(password: string): {
  normalized: string;
  warnings: string[];
} {
  const normalized = normalizeBackupPassword(password);
  if (Array.from(normalized).length < 12) {
    throw new ProviderBackupError("weak_password", "Custom backup password must be at least 12 characters.");
  }
  const lower = normalized.toLowerCase();
  const warnings: string[] = [];
  if (Array.from(normalized).length < 16) warnings.push("short");
  if (/^(.)\1{7,}$/u.test(normalized)) warnings.push("repeated-character");
  if (/(123456|abcdef|qwerty|password|parola)/iu.test(lower)) warnings.push("common-pattern");
  if (/^(.{2,8})\1{2,}$/u.test(normalized)) warnings.push("repeated-pattern");
  return { normalized, warnings };
}

const RECOVERY_ONSETS = ["b", "c", "d", "f", "g", "h", "k", "m"] as const;
const RECOVERY_VOWELS = ["a", "e", "i", "o"] as const;
const RECOVERY_CODAS = ["n", "r"] as const;

function recoverySyllable(index: number) {
  return `${RECOVERY_ONSETS[(index >>> 3) & 7]}${RECOVERY_VOWELS[(index >>> 1) & 3]}${RECOVERY_CODAS[index & 1]}`;
}

export function recoveryWordAt(index: number): string {
  if (!Number.isInteger(index) || index < 0 || index >= 4096) {
    throw new RangeError("Recovery word index must be 0..4095.");
  }
  return `${recoverySyllable(index >>> 6)}${recoverySyllable(index & 63)}`;
}

export function requireEntropy(randomBytes?: SecureRandomBytes): SecureRandomBytes {
  if (typeof randomBytes !== "function") {
    throw new ProviderBackupError("entropy_unavailable", "Secure random entropy is unavailable.");
  }
  return (length: number) => {
    const bytes = randomBytes(length);
    if (!(bytes instanceof Uint8Array) || bytes.length !== length) {
      throw new ProviderBackupError("entropy_unavailable", "Secure random entropy is unavailable.");
    }
    return bytes;
  };
}

export function generateRecoveryPhrase(randomBytes?: SecureRandomBytes): string {
  const random = requireEntropy(randomBytes);
  const bytes = random(12);
  const words: string[] = [];
  for (let i = 0; i < 12; i += 2) {
    const index = (((bytes[i] << 8) | bytes[i + 1]) & 0x0fff) >>> 0;
    words.push(recoveryWordAt(index));
  }
  return words.join("-");
}

function parseJsonObject(text: string, errorCode: ProviderBackupErrorCode, message: string) {
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not object");
    return parsed as Record<string, unknown>;
  } catch {
    throw new ProviderBackupError(errorCode, message);
  }
}

function decodeUtf8Strict(bytes: Uint8Array, code: ProviderBackupErrorCode, message: string): string {
  const text = decoder.decode(bytes);
  const roundTrip = encoder.encode(text);
  if (!equalBytesConstantTime(bytes, roundTrip)) throw new ProviderBackupError(code, message);
  return text;
}

function assertKdfBounds(kdf: BackupHeaderV1["kdf"]) {
  const { N, r, p, dk_len: dkLen } = kdf;
  const powerOfTwo = Number.isInteger(N) && N > 1 && (N & (N - 1)) === 0;
  const work = N * r * p;
  const estimatedMemory = 128 * r * (N + p + 1);
  if (
    !powerOfTwo ||
    N < 2 ** 14 ||
    N > 2 ** 17 ||
    !Number.isInteger(r) ||
    r < 1 ||
    r > 8 ||
    !Number.isInteger(p) ||
    p < 1 ||
    p > 4 ||
    dkLen !== 32 ||
    work > 2 ** 20 ||
    estimatedMemory > SCRYPT_MAXMEM
  ) {
    throw new ProviderBackupError("kdf_bounds", "Backup KDF parameters are outside supported safety bounds.");
  }
}

function validateHeader(value: Record<string, unknown>): BackupHeaderV1 {
  if (value.format !== BACKUP_FORMAT || value.format_version !== 1) {
    throw new ProviderBackupError("invalid_file", "This is not a supported LegendStream backup file.");
  }
  if (typeof value.schema_version === "number" && value.schema_version > BACKUP_SCHEMA_VERSION) {
    throw new ProviderBackupError("unsupported_version", "This backup was created by a newer LegendStream version.");
  }
  if (value.schema_version !== 1) {
    throw new ProviderBackupError("invalid_file", "Backup schema version is invalid.");
  }
  if (value.password_normalization !== PASSWORD_NORMALIZATION) {
    throw new ProviderBackupError("unsupported_version", "Backup password normalization profile is unsupported.");
  }
  const kdf = value.kdf as BackupHeaderV1["kdf"] | undefined;
  const keySchedule = value.key_schedule as BackupHeaderV1["key_schedule"] | undefined;
  const cipher = value.cipher as BackupHeaderV1["cipher"] | undefined;
  if (
    !kdf || kdf.name !== "scrypt" || typeof kdf.salt !== "string" ||
    !keySchedule || keySchedule.name !== "hkdf-sha256" || keySchedule.version !== 1 ||
    !cipher || cipher.name !== "aes-256-gcm" || typeof cipher.iv !== "string" ||
    typeof value.password_check !== "string" ||
    value.payload_encoding !== "utf8-json" ||
    typeof value.created_at !== "string"
  ) {
    throw new ProviderBackupError("invalid_file", "Backup header is incomplete or invalid.");
  }
  assertKdfBounds(kdf);
  const salt = base64UrlDecode(kdf.salt);
  const iv = base64UrlDecode(cipher.iv);
  const passwordCheck = base64UrlDecode(value.password_check);
  if (salt.length !== 16 || iv.length !== 12 || passwordCheck.length !== 16) {
    throw new ProviderBackupError("invalid_file", "Backup cryptographic header sizes are invalid.");
  }
  return value as unknown as BackupHeaderV1;
}

function validatePayload(value: Record<string, unknown>): BackupPayloadV1 {
  if (typeof value.schema_version === "number" && value.schema_version > 1) {
    throw new ProviderBackupError("unsupported_version", "This backup was created by a newer LegendStream version.");
  }
  if (value.schema_version !== 1 || !Array.isArray(value.providers) || typeof value.exported_at !== "string") {
    throw new ProviderBackupError("invalid_payload", "Backup payload is incomplete or invalid.");
  }
  return value as BackupPayloadV1;
}

async function deriveBackupKeys(
  password: string,
  salt: Uint8Array,
  kdf: BackupHeaderV1["kdf"],
  onProgress?: BackupKdfProgress,
) {
  const normalized = normalizeBackupPassword(password);
  const passwordBytes = encoder.encode(normalized);
  let lastProgress = -1;
  let lastAt = 0;
  const start = Date.now();
  const master = await scryptAsync(passwordBytes, salt, {
    N: kdf.N,
    r: kdf.r,
    p: kdf.p,
    dkLen: kdf.dk_len,
    asyncTick: SCRYPT_ASYNC_TICK_MS,
    maxmem: SCRYPT_MAXMEM,
    onProgress: onProgress
      ? (progress) => {
          const now = Date.now();
          if (progress === 1 || progress - lastProgress >= 0.02 || now - lastAt >= 100) {
            lastProgress = progress;
            lastAt = now;
            onProgress(progress);
          }
        }
      : undefined,
  });
  const encryptionKey = hkdf(sha256, master, salt, encoder.encode(HKDF_ENCRYPTION_INFO), 32);
  const checkKey = hkdf(sha256, master, salt, encoder.encode(HKDF_CHECK_INFO), 32);
  master.fill(0);
  passwordBytes.fill(0);
  return { encryptionKey, checkKey, kdfMs: Date.now() - start };
}

function passwordCheckFor(checkKey: Uint8Array) {
  return hmac(sha256, checkKey, encoder.encode(PASSWORD_CHECK_DOMAIN)).slice(0, 16);
}

export async function encryptBackupPayload(
  payload: BackupPayloadV1,
  password: string,
  randomBytes?: SecureRandomBytes,
  onProgress?: BackupKdfProgress,
): Promise<EncryptedBackupResult> {
  const random = requireEntropy(randomBytes);
  const salt = random(16);
  const iv = random(12);
  const kdf: BackupHeaderV1["kdf"] = {
    ...SCRYPT_WRITER_PROFILE,
    salt: base64UrlEncode(salt),
  };
  const { encryptionKey, checkKey, kdfMs } = await deriveBackupKeys(password, salt, kdf, onProgress);
  try {
    const header: BackupHeaderV1 = {
      format: BACKUP_FORMAT,
      format_version: 1,
      schema_version: 1,
      created_at: payload.exported_at,
      password_normalization: PASSWORD_NORMALIZATION,
      kdf,
      key_schedule: { name: "hkdf-sha256", version: 1 },
      cipher: { name: "aes-256-gcm", iv: base64UrlEncode(iv) },
      password_check: base64UrlEncode(passwordCheckFor(checkKey)),
      payload_encoding: "utf8-json",
    };
    const headerBytes = encoder.encode(JSON.stringify(header));
    const plaintext = encoder.encode(JSON.stringify(payload));
    const ciphertextAndTag = gcm(encryptionKey, iv, headerBytes).encrypt(plaintext);
    plaintext.fill(0);
    const encodedCiphertext = encoder.encode(base64UrlEncode(ciphertextAndTag));
    const bytes = concatBytes(headerBytes, Uint8Array.of(0x0a), encodedCiphertext);
    return { bytes, kdfMs };
  } finally {
    encryptionKey.fill(0);
    checkKey.fill(0);
    salt.fill(0);
    iv.fill(0);
  }
}

export async function decryptBackupFile(
  bytes: Uint8Array,
  password: string,
  onProgress?: BackupKdfProgress,
): Promise<DecryptedBackupResult> {
  if (!bytes.length || bytes.length > MAX_BACKUP_FILE_BYTES || (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf)) {
    throw new ProviderBackupError("invalid_file", "Backup file is empty, too large, or contains a BOM.");
  }
  const firstLf = bytes.indexOf(0x0a);
  if (firstLf <= 0 || firstLf === bytes.length - 1 || bytes.indexOf(0x0a, firstLf + 1) !== -1) {
    throw new ProviderBackupError("invalid_file", "Backup must contain exactly one header line and one ciphertext line.");
  }
  const headerBytes = bytes.slice(0, firstLf);
  if (headerBytes[headerBytes.length - 1] === 0x0d) {
    throw new ProviderBackupError("invalid_file", "Backup header separator must be LF, not CRLF.");
  }
  const headerText = decodeUtf8Strict(headerBytes, "invalid_file", "Backup header is not valid UTF-8.");
  const header = validateHeader(parseJsonObject(headerText, "invalid_file", "Backup header is invalid JSON."));
  const ciphertextText = decodeUtf8Strict(bytes.slice(firstLf + 1), "invalid_file", "Backup ciphertext is not valid ASCII/UTF-8.");
  const ciphertextAndTag = base64UrlDecode(ciphertextText);
  if (ciphertextAndTag.length < 16) {
    throw new ProviderBackupError("invalid_file", "Backup ciphertext is too short.");
  }
  const salt = base64UrlDecode(header.kdf.salt);
  const iv = base64UrlDecode(header.cipher.iv);
  const { encryptionKey, checkKey, kdfMs } = await deriveBackupKeys(password, salt, header.kdf, onProgress);
  try {
    const expectedCheck = passwordCheckFor(checkKey);
    const actualCheck = base64UrlDecode(header.password_check);
    if (!equalBytesConstantTime(expectedCheck, actualCheck)) {
      throw new ProviderBackupError("wrong_password", "Backup password is incorrect.");
    }
    let plaintext: Uint8Array;
    try {
      plaintext = gcm(encryptionKey, iv, headerBytes).decrypt(ciphertextAndTag);
    } catch {
      throw new ProviderBackupError("corrupt_file", "Backup ciphertext is damaged or has been modified.");
    }
    try {
      const payloadText = decodeUtf8Strict(plaintext, "corrupt_file", "Decrypted backup payload is not valid UTF-8.");
      const payload = validatePayload(parseJsonObject(payloadText, "invalid_payload", "Backup payload is invalid JSON."));
      return { payload, header, kdfMs };
    } finally {
      plaintext.fill(0);
    }
  } finally {
    encryptionKey.fill(0);
    checkKey.fill(0);
    salt.fill(0);
    iv.fill(0);
  }
}

export function secureRecordByteLength(value: unknown): number {
  return utf8ByteLength(JSON.stringify(value));
}

export function assertSecureRecordFits(value: unknown, label = "secure record") {
  if (secureRecordByteLength(value) > MAX_SECURE_RECORD_BYTES) {
    throw new ProviderBackupError("secure_record_too_large", `${label} exceeds the supported secure storage size.`);
  }
}
