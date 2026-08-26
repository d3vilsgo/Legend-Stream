import "./cryptoBootstrap";

import { compactCredentialFields, hasRequiredCredentialFields } from "./providerCredentialState";
import {
  assertSecureRecordFits,
  base64UrlEncode,
  decryptBackupFile,
  encryptBackupPayload,
  type BackupKdfProgress,
  type BackupPayloadV1,
  type BackupProviderRecord,
  type ProviderBackupErrorCode,
  ProviderBackupError,
} from "./providerBackupCore";
import {
  deleteProviderBackupExtension,
  deleteRootBackupExtension,
  readProviderBackupExtension,
  readRootBackupExtension,
  saveProviderBackupExtension,
  saveRootBackupExtension,
  type OpaqueExtensionRecord,
} from "./providerBackupExtensions";
import { resolveImportTargets, type ImportConflictChoice } from "./providerBackupPlanning";
import {
  deleteCredentials,
  readCredentials,
  saveCredentials,
  type ProviderSecrets,
} from "./secureCredentials";
import { assertSecureEntropyAvailable, secureRandomBytes } from "./cryptoBootstrap";
import type { ProviderConfig } from "@/context/PlayerContext";

const KNOWN_PROVIDER_FIELDS = new Set([
  "id",
  "name",
  "type",
  "createdAt",
  "connectedAt",
  "lastLoadedAt",
  "channelCount",
  "credentials",
]);
const KNOWN_CREDENTIAL_FIELDS = new Set([
  "url",
  "playlistUrl",
  "epgUrl",
  "username",
  "password",
  "mac",
]);
const KNOWN_PAYLOAD_FIELDS = new Set([
  "schema_version",
  "exported_at",
  "active_provider_id",
  "providers",
]);

export type BackupSkipReason =
  | "credentials_missing"
  | "credentials_error"
  | "credentials_incomplete"
  | "secure_record_too_large"
  | "extensions_error";

export type BackupSkippedProvider = {
  providerId: string;
  reason: BackupSkipReason;
};

export type ProviderBackupExport = {
  bytes: Uint8Array;
  exportedCount: number;
  skipped: BackupSkippedProvider[];
  kdfMs: number;
};

export type ImportedProviderCandidate = {
  originalId: string;
  provider: ProviderConfig;
  secrets: ProviderSecrets;
  opaque: OpaqueExtensionRecord;
};

export type ProviderBackupPreview = {
  candidates: ImportedProviderCandidate[];
  rootOpaque: OpaqueExtensionRecord;
  kdfMs: number;
};

export type { ImportConflictChoice } from "./providerBackupPlanning";

export type ImportConflict = {
  providerId: string;
  incomingName: string;
  existingName: string;
};

export type ImportPlanItem = ImportedProviderCandidate & {
  targetId: string;
  overwrite: boolean;
};

export type ImportPlan = {
  items: ImportPlanItem[];
  rootOpaque: OpaqueExtensionRecord;
  skippedCount: number;
};

export type ImportCommitResult = {
  importedCount: number;
  skippedCount: number;
  diagnostics: ProviderImportCommitDiagnostics;
};

export type ProviderMetadataCommitMetrics = {
  prepareMs: number;
  asyncStorageWriteMs: number;
  stateApplyMs: number;
  asyncStorageWriteCount: number;
};

export type ProviderImportProgressPhase =
  | "snapshot"
  | "credential_write"
  | "extension_write"
  | "root_write"
  | "metadata";

export type ProviderImportProgress = {
  phase: ProviderImportProgressPhase;
  completed: number;
  total: number;
};

export type ProviderImportProviderMetrics = {
  index: number;
  credentialSnapshotReadMs: number;
  extensionSnapshotReadMs: number;
  credentialWriteMs: number;
  credentialVerifyReadMs: number;
  extensionWriteMs: number;
  extensionVerifyReadMs: number;
};

export type ProviderImportCommitDiagnostics = {
  commitTotalMs: number;
  snapshotTotalMs: number;
  rootSnapshotReadMs: number;
  rootWriteMs: number;
  rootVerifyReadMs: number;
  metadata: ProviderMetadataCommitMetrics;
  providers: ProviderImportProviderMetrics[];
  calls: {
    credentialRead: number;
    credentialWrite: number;
    extensionRead: number;
    extensionWrite: number;
    rootRead: number;
    rootWrite: number;
    asyncStorageWrite: number;
  };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function unknownFields(source: Record<string, unknown>, known: ReadonlySet<string>) {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) {
    if (!known.has(key)) result[key] = value;
  }
  return result;
}

function hasKeys(value: OpaqueExtensionRecord) {
  return Object.keys(value).length > 0;
}

function mergeOpaque(
  local: OpaqueExtensionRecord | undefined,
  incoming: OpaqueExtensionRecord,
): OpaqueExtensionRecord {
  const result = { ...(local ?? {}), ...incoming };
  for (const section of ["provider", "credentials"] as const) {
    const left = isRecord(local?.[section]) ? local?.[section] as Record<string, unknown> : {};
    const right = isRecord(incoming[section]) ? incoming[section] as Record<string, unknown> : {};
    if (Object.keys(left).length || Object.keys(right).length) {
      result[section] = { ...left, ...right };
    }
  }
  return result;
}

function backupProviderFrom(
  provider: ProviderConfig,
  secrets: ProviderSecrets,
  opaque: OpaqueExtensionRecord,
): BackupProviderRecord {
  const providerOpaque = isRecord(opaque.provider) ? opaque.provider : {};
  const credentialOpaque = isRecord(opaque.credentials) ? opaque.credentials : {};
  return {
    ...providerOpaque,
    id: provider.id,
    name: provider.name,
    type: provider.type,
    createdAt: provider.createdAt,
    connectedAt: provider.connectedAt,
    lastLoadedAt: provider.lastLoadedAt,
    channelCount: provider.channelCount,
    credentials: {
      ...credentialOpaque,
      ...compactCredentialFields(secrets),
    },
  };
}

function skip(provider: ProviderConfig, reason: BackupSkipReason): BackupSkippedProvider {
  return { providerId: provider.id, reason };
}

export async function createProviderBackup(
  providers: readonly ProviderConfig[],
  activeProviderId: string | undefined,
  password: string,
  onProgress?: BackupKdfProgress,
): Promise<ProviderBackupExport> {
  assertSecureEntropyAvailable();
  const exportedProviders: BackupProviderRecord[] = [];
  const skipped: BackupSkippedProvider[] = [];

  for (const provider of providers) {
    const credentialRead = await readCredentials(provider.id);
    if (credentialRead.status === "error") {
      skipped.push(skip(provider, "credentials_error"));
      continue;
    }
    if (credentialRead.status === "missing") {
      skipped.push(skip(provider, "credentials_missing"));
      continue;
    }
    const secrets = compactCredentialFields(credentialRead.secrets);
    if (!hasRequiredCredentialFields(provider.type, secrets)) {
      skipped.push(skip(provider, "credentials_incomplete"));
      continue;
    }
    try {
      assertSecureRecordFits(secrets, "provider credentials");
    } catch {
      skipped.push(skip(provider, "secure_record_too_large"));
      continue;
    }

    const extensionRead = await readProviderBackupExtension(provider.id);
    if (extensionRead.status === "error") {
      skipped.push(skip(provider, "extensions_error"));
      continue;
    }
    const opaque = extensionRead.status === "found" ? extensionRead.value : {};
    try {
      if (hasKeys(opaque)) assertSecureRecordFits(opaque, "provider extensions");
      exportedProviders.push(backupProviderFrom(provider, secrets, opaque));
    } catch {
      skipped.push(skip(provider, "secure_record_too_large"));
    }
  }

  const rootExtensionRead = await readRootBackupExtension();
  if (rootExtensionRead.status === "error") throw rootExtensionRead.error;
  const rootOpaque = rootExtensionRead.status === "found" ? rootExtensionRead.value : {};
  if (hasKeys(rootOpaque)) assertSecureRecordFits(rootOpaque, "root backup extensions");

  const exportedIds = new Set(exportedProviders.map((provider) => provider.id));
  const now = new Date().toISOString();
  const payload: BackupPayloadV1 = {
    ...rootOpaque,
    schema_version: 1,
    exported_at: now,
    providers: exportedProviders,
    ...(activeProviderId && exportedIds.has(activeProviderId)
      ? { active_provider_id: activeProviderId }
      : {}),
  };
  const encrypted = await encryptBackupPayload(payload, password, secureRandomBytes, onProgress);
  return {
    bytes: encrypted.bytes,
    exportedCount: exportedProviders.length,
    skipped,
    kdfMs: encrypted.kdfMs,
  };
}

function invalidPayload(message: string): never {
  throw new ProviderBackupError("invalid_payload", message);
}

function providerCandidateFrom(record: BackupProviderRecord): ImportedProviderCandidate {
  if (!isRecord(record)) invalidPayload("Backup provider record is invalid.");
  const id = typeof record.id === "string" ? record.id.trim() : "";
  const name = typeof record.name === "string" ? record.name.trim() : "";
  const type = record.type;
  if (!id || id.length > 256 || !name || name.length > 256) {
    invalidPayload("Backup provider identity is invalid.");
  }
  if (type !== "xtream" && type !== "m3u" && type !== "stalker") {
    invalidPayload("Backup provider type is unsupported.");
  }
  if (!Number.isFinite(record.createdAt) || record.createdAt <= 0) {
    invalidPayload("Backup provider creation time is invalid.");
  }
  if (!isRecord(record.credentials)) {
    invalidPayload("Backup provider credentials are invalid.");
  }

  const secrets = compactCredentialFields({
    url: typeof record.credentials.url === "string" ? record.credentials.url : undefined,
    playlistUrl: typeof record.credentials.playlistUrl === "string" ? record.credentials.playlistUrl : undefined,
    epgUrl: typeof record.credentials.epgUrl === "string" ? record.credentials.epgUrl : undefined,
    username: typeof record.credentials.username === "string" ? record.credentials.username : undefined,
    password: typeof record.credentials.password === "string" ? record.credentials.password : undefined,
    mac: typeof record.credentials.mac === "string" ? record.credentials.mac : undefined,
  });
  if (!hasRequiredCredentialFields(type, secrets)) {
    invalidPayload("Backup provider credentials are incomplete.");
  }
  assertSecureRecordFits(secrets, "provider credentials");

  const providerUnknown = unknownFields(record, KNOWN_PROVIDER_FIELDS);
  const credentialUnknown = unknownFields(record.credentials, KNOWN_CREDENTIAL_FIELDS);
  const opaque: OpaqueExtensionRecord = {};
  if (Object.keys(providerUnknown).length) opaque.provider = providerUnknown;
  if (Object.keys(credentialUnknown).length) opaque.credentials = credentialUnknown;
  if (hasKeys(opaque)) assertSecureRecordFits(opaque, "provider extensions");

  const url = secrets.url || secrets.playlistUrl || "";
  const provider: ProviderConfig = {
    id,
    name,
    type,
    url,
    playlistUrl: secrets.playlistUrl || secrets.url || "",
    epgUrl: secrets.epgUrl,
    username: secrets.username,
    password: secrets.password,
    mac: secrets.mac,
    createdAt: record.createdAt,
    connectedAt:
      typeof record.connectedAt === "string"
        ? record.connectedAt
        : new Date(record.createdAt).toISOString(),
    lastLoadedAt: typeof record.lastLoadedAt === "number" ? record.lastLoadedAt : undefined,
    channelCount: typeof record.channelCount === "number" ? record.channelCount : undefined,
    needsCredentials: false,
  };
  return { originalId: id, provider, secrets, opaque };
}

function previewFromPayload(payload: BackupPayloadV1, kdfMs: number): ProviderBackupPreview {
  const seen = new Set<string>();
  const candidates = payload.providers.map((record) => {
    const candidate = providerCandidateFrom(record);
    if (seen.has(candidate.originalId)) invalidPayload("Backup contains duplicate provider IDs.");
    seen.add(candidate.originalId);
    return candidate;
  });
  const rootOpaque = unknownFields(payload, KNOWN_PAYLOAD_FIELDS);
  if (hasKeys(rootOpaque)) assertSecureRecordFits(rootOpaque, "root backup extensions");
  return { candidates, rootOpaque, kdfMs };
}

export async function decryptProviderBackupForImport(
  bytes: Uint8Array,
  password: string,
  onProgress?: BackupKdfProgress,
): Promise<ProviderBackupPreview> {
  // T4-B: import also hard-fails before KDF/parsing if the platform CSPRNG is unavailable.
  assertSecureEntropyAvailable();
  const decrypted = await decryptBackupFile(bytes, password, onProgress);
  return previewFromPayload(decrypted.payload, decrypted.kdfMs);
}

export function listImportConflicts(
  preview: ProviderBackupPreview,
  currentProviders: readonly ProviderConfig[],
): ImportConflict[] {
  const current = new Map(currentProviders.map((provider) => [provider.id, provider]));
  return preview.candidates.flatMap((candidate) => {
    const existing = current.get(candidate.originalId);
    return existing
      ? [{
          providerId: candidate.originalId,
          incomingName: candidate.provider.name,
          existingName: existing.name,
        }]
      : [];
  });
}

function allocatePortableProviderId() {
  return `import-${base64UrlEncode(secureRandomBytes(12))}`;
}

export function buildImportPlan(
  preview: ProviderBackupPreview,
  currentProviders: readonly ProviderConfig[],
  choices: Readonly<Record<string, ImportConflictChoice>>,
): ImportPlan {
  assertSecureEntropyAvailable();
  const currentIds = new Set(currentProviders.map((provider) => provider.id));
  const byId = new Map(preview.candidates.map((candidate) => [candidate.originalId, candidate]));
  const resolutions = resolveImportTargets(
    preview.candidates.map((candidate) => candidate.originalId),
    currentIds,
    choices,
    () => allocatePortableProviderId(),
  );
  const items: ImportPlanItem[] = [];
  let skippedCount = 0;
  for (const resolution of resolutions) {
    if (resolution.skipped || !resolution.targetId) {
      skippedCount += 1;
      continue;
    }
    const candidate = byId.get(resolution.sourceId);
    if (!candidate) throw new Error("Import plan references an unknown provider.");
    items.push({
      ...candidate,
      targetId: resolution.targetId,
      overwrite: resolution.overwrite,
      provider: resolution.targetId === candidate.originalId
        ? candidate.provider
        : { ...candidate.provider, id: resolution.targetId },
    });
  }
  return { items, rootOpaque: preview.rootOpaque, skippedCount };
}

type CredentialSnapshot =
  | { status: "found"; secrets: ProviderSecrets }
  | { status: "missing" };

type ExtensionSnapshot =
  | { status: "found"; value: OpaqueExtensionRecord }
  | { status: "missing" };

type TargetSnapshot = {
  item: ImportPlanItem;
  metric: ProviderImportProviderMetrics;
  credential: CredentialSnapshot;
  extension: ExtensionSnapshot;
  extensionToWrite: OpaqueExtensionRecord;
};

async function snapshotTargets(
  plan: ImportPlan,
  diagnostics: ProviderImportCommitDiagnostics,
  onProgress?: (progress: ProviderImportProgress) => void,
): Promise<{
  targets: TargetSnapshot[];
  root: ExtensionSnapshot;
  rootToWrite: OpaqueExtensionRecord;
}> {
  const targets: TargetSnapshot[] = [];
  const snapshotStartedAt = Date.now();
  for (const [index, item] of plan.items.entries()) {
    onProgress?.({ phase: "snapshot", completed: index, total: plan.items.length });
    const metric: ProviderImportProviderMetrics = {
      index: index + 1,
      credentialSnapshotReadMs: 0,
      extensionSnapshotReadMs: 0,
      credentialWriteMs: 0,
      credentialVerifyReadMs: 0,
      extensionWriteMs: 0,
      extensionVerifyReadMs: 0,
    };
    diagnostics.providers.push(metric);
    diagnostics.calls.credentialRead += 1;
    const credentialStartedAt = Date.now();
    const credential = await readCredentials(item.targetId);
    metric.credentialSnapshotReadMs = Date.now() - credentialStartedAt;
    if (credential.status === "error") throw credential.error;
    if (!item.overwrite && credential.status === "found") {
      throw new Error("Imported provider ID unexpectedly collides with secure credential storage.");
    }
    diagnostics.calls.extensionRead += 1;
    const extensionStartedAt = Date.now();
    const extension = await readProviderBackupExtension(item.targetId);
    metric.extensionSnapshotReadMs = Date.now() - extensionStartedAt;
    if (extension.status === "error") throw extension.error;
    if (!item.overwrite && extension.status === "found") {
      throw new Error("Imported provider ID unexpectedly collides with secure extension storage.");
    }
    const localOpaque = extension.status === "found" ? extension.value : undefined;
    const extensionToWrite = mergeOpaque(localOpaque, item.opaque);
    if (hasKeys(extensionToWrite)) assertSecureRecordFits(extensionToWrite, "provider extensions");
    targets.push({ item, metric, credential, extension, extensionToWrite });
  }

  onProgress?.({ phase: "snapshot", completed: plan.items.length, total: plan.items.length });
  diagnostics.calls.rootRead += 1;
  const rootStartedAt = Date.now();
  const rootRead = await readRootBackupExtension();
  diagnostics.rootSnapshotReadMs = Date.now() - rootStartedAt;
  if (rootRead.status === "error") throw rootRead.error;
  const root: ExtensionSnapshot = rootRead.status === "found"
    ? { status: "found", value: rootRead.value }
    : { status: "missing" };
  const rootToWrite = { ...(root.status === "found" ? root.value : {}), ...plan.rootOpaque };
  if (hasKeys(rootToWrite)) assertSecureRecordFits(rootToWrite, "root backup extensions");
  diagnostics.snapshotTotalMs = Date.now() - snapshotStartedAt;
  return { targets, root, rootToWrite };
}

async function restoreCredential(targetId: string, snapshot: CredentialSnapshot) {
  if (snapshot.status === "found") await saveCredentials(targetId, snapshot.secrets);
  else await deleteCredentials(targetId);
}

async function restoreExtension(targetId: string, snapshot: ExtensionSnapshot) {
  if (snapshot.status === "found") await saveProviderBackupExtension(targetId, snapshot.value);
  else await deleteProviderBackupExtension(targetId);
}

async function restoreRoot(snapshot: ExtensionSnapshot) {
  if (snapshot.status === "found") await saveRootBackupExtension(snapshot.value);
  else await deleteRootBackupExtension();
}

export async function commitProviderImport(
  plan: ImportPlan,
  mergeImportedProviders: (providers: ProviderConfig[]) => Promise<ProviderMetadataCommitMetrics>,
  onProgress?: (progress: ProviderImportProgress) => void,
): Promise<ImportCommitResult> {
  assertSecureEntropyAvailable();
  const commitStartedAt = Date.now();
  const diagnostics: ProviderImportCommitDiagnostics = {
    commitTotalMs: 0,
    snapshotTotalMs: 0,
    rootSnapshotReadMs: 0,
    rootWriteMs: 0,
    rootVerifyReadMs: 0,
    metadata: {
      prepareMs: 0,
      asyncStorageWriteMs: 0,
      stateApplyMs: 0,
      asyncStorageWriteCount: 0,
    },
    providers: [],
    calls: {
      credentialRead: 0,
      credentialWrite: 0,
      extensionRead: 0,
      extensionWrite: 0,
      rootRead: 0,
      rootWrite: 0,
      asyncStorageWrite: 0,
    },
  };
  // All reads and size calculations happen before the first write.
  const snapshots = await snapshotTargets(plan, diagnostics, onProgress);
  const touched: TargetSnapshot[] = [];
  let rootTouched = false;

  try {
    for (const [index, target] of snapshots.targets.entries()) {
      // Mark the target before its first write: SecureStore may persist setItem and
      // then fail during read-back verification, which still requires rollback.
      touched.push(target);
      onProgress?.({ phase: "credential_write", completed: index, total: snapshots.targets.length });
      diagnostics.calls.credentialWrite += 1;
      await saveCredentials(target.item.targetId, target.item.secrets, (metrics) => {
        target.metric.credentialWriteMs = metrics.writeMs;
        target.metric.credentialVerifyReadMs = metrics.verifyReadMs;
        diagnostics.calls.credentialRead += 1;
      });
      if (hasKeys(target.extensionToWrite)) {
        onProgress?.({ phase: "extension_write", completed: index, total: snapshots.targets.length });
        diagnostics.calls.extensionWrite += 1;
        await saveProviderBackupExtension(target.item.targetId, target.extensionToWrite, (metrics) => {
          target.metric.extensionWriteMs = metrics.writeMs;
          target.metric.extensionVerifyReadMs = metrics.verifyReadMs;
          diagnostics.calls.extensionRead += 1;
        });
      }
    }
    onProgress?.({ phase: "credential_write", completed: snapshots.targets.length, total: snapshots.targets.length });
    if (hasKeys(snapshots.rootToWrite)) {
      rootTouched = true;
      onProgress?.({ phase: "root_write", completed: 0, total: 1 });
      diagnostics.calls.rootWrite += 1;
      await saveRootBackupExtension(snapshots.rootToWrite, (metrics) => {
        diagnostics.rootWriteMs = metrics.writeMs;
        diagnostics.rootVerifyReadMs = metrics.verifyReadMs;
        diagnostics.calls.rootRead += 1;
      });
      onProgress?.({ phase: "root_write", completed: 1, total: 1 });
    }

    // Metadata is the final commit point; the PlayerContext method must propagate errors.
    onProgress?.({ phase: "metadata", completed: 0, total: 1 });
    diagnostics.metadata = await mergeImportedProviders(
      snapshots.targets.map(({ item }) => item.provider),
    );
    diagnostics.calls.asyncStorageWrite = diagnostics.metadata.asyncStorageWriteCount;
    onProgress?.({ phase: "metadata", completed: 1, total: 1 });
    diagnostics.commitTotalMs = Date.now() - commitStartedAt;
    return {
      importedCount: snapshots.targets.length,
      skippedCount: plan.skippedCount,
      diagnostics,
    };
  } catch (error) {
    const rollbackErrors: Error[] = [];
    for (const target of [...touched].reverse()) {
      try {
        await restoreCredential(target.item.targetId, target.credential);
        await restoreExtension(target.item.targetId, target.extension);
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError instanceof Error ? rollbackError : new Error("Import rollback failed."));
      }
    }
    if (rootTouched) {
      try {
        await restoreRoot(snapshots.root);
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError instanceof Error ? rollbackError : new Error("Root extension rollback failed."));
      }
    }
    if (rollbackErrors.length) {
      throw new Error("Provider import failed and secure rollback was incomplete.");
    }
    throw error;
  }
}

export function providerBackupErrorCode(error: unknown): ProviderBackupErrorCode | null {
  return error instanceof ProviderBackupError ? error.code : null;
}
