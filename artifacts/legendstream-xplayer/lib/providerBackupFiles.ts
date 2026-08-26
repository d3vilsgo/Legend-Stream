import AsyncStorage from "@react-native-async-storage/async-storage";
import * as DocumentPicker from "expo-document-picker";
import { Directory, File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { base64UrlEncode, MAX_BACKUP_FILE_BYTES } from "./providerBackupCore";
import { assertSecureEntropyAvailable, secureRandomBytes } from "./cryptoBootstrap";

const TEMP_DIRECTORY_NAME = "legendstream-provider-backups";
const TEMP_FILE_PREFIX = "LegendStream-Accounts-";
const TEMP_MANIFEST_KEY = "@legendstream/provider-backup-temp-v1";
const SHARE_GRACE_MS = 30 * 60 * 1000;

type TempManifestEntry = {
  uri: string;
  createdAt: number;
  cleanupAfter: number;
};

function tempDirectory() {
  return new Directory(Paths.cache, TEMP_DIRECTORY_NAME);
}

async function readManifest(): Promise<TempManifestEntry[]> {
  const raw = await AsyncStorage.getItem(TEMP_MANIFEST_KEY);
  if (raw === null) return [];
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error("Backup temp manifest is invalid.");
  return parsed.filter((entry): entry is TempManifestEntry =>
    Boolean(entry) &&
    typeof entry === "object" &&
    typeof entry.uri === "string" &&
    typeof entry.createdAt === "number" &&
    typeof entry.cleanupAfter === "number",
  );
}

async function writeManifest(entries: TempManifestEntry[]) {
  await AsyncStorage.setItem(TEMP_MANIFEST_KEY, JSON.stringify(entries));
}

function deleteOwnTempFile(uri: string) {
  const directory = tempDirectory();
  if (!uri.startsWith(directory.uri)) return;
  const file = new File(uri);
  if (file.exists) file.delete();
}

async function removeManifestUri(uri: string) {
  const entries = await readManifest();
  await writeManifest(entries.filter((entry) => entry.uri !== uri));
}

async function registerTempFile(uri: string, cleanupAfter: number) {
  const entries = await readManifest();
  const next = entries.filter((entry) => entry.uri !== uri);
  next.push({ uri, createdAt: Date.now(), cleanupAfter });
  await writeManifest(next);
}

export async function cleanupProviderBackupTempFiles(options?: { coldStart?: boolean }) {
  const directory = tempDirectory();
  directory.create({ idempotent: true, intermediates: true });
  const now = Date.now();
  const manifest = await readManifest();
  const due = new Set(
    manifest
      .filter((entry) => options?.coldStart || entry.cleanupAfter <= now)
      .map((entry) => entry.uri),
  );

  // On a cold start, every file in our private backup-temp directory is an orphan
  // from a previous process. During a live session only manifest entries past the
  // grace period are removed so Android share targets keep access long enough.
  if (options?.coldStart) {
    for (const item of directory.list()) {
      if (item instanceof File && item.name.startsWith(TEMP_FILE_PREFIX) && item.name.endsWith(".lsxbackup")) {
        due.add(item.uri);
      }
    }
  }

  for (const uri of due) deleteOwnTempFile(uri);
  await writeManifest(manifest.filter((entry) => !due.has(entry.uri)));
}

function scheduleGraceCleanup(uri: string) {
  setTimeout(() => {
    void (async () => {
      try {
        deleteOwnTempFile(uri);
        await removeManifestUri(uri);
      } catch (error) {
        console.warn(
          "BACKUP_TEMP_CLEANUP_FAILED",
          error instanceof Error ? error.message : "unknown error",
        );
      }
    })();
  }, SHARE_GRACE_MS);
}

export async function shareEncryptedProviderBackup(bytes: Uint8Array): Promise<string> {
  assertSecureEntropyAvailable();
  if (!bytes.length || bytes.length > MAX_BACKUP_FILE_BYTES) {
    throw new Error("Encrypted backup size is invalid.");
  }
  if (!(await Sharing.isAvailableAsync())) {
    throw new Error("File sharing is unavailable on this device.");
  }

  const directory = tempDirectory();
  directory.create({ idempotent: true, intermediates: true });
  const date = new Date().toISOString().slice(0, 10);
  const suffix = base64UrlEncode(secureRandomBytes(6));
  const file = new File(directory, `${TEMP_FILE_PREFIX}${date}-${suffix}.lsxbackup`);
  file.create({ overwrite: false, intermediates: true });
  file.write(bytes);

  // Give a share consumer a full day if the share sheet itself never resolves
  // (process death, target crash). A resolved/cancelled share is shortened to 30m.
  await registerTempFile(file.uri, Date.now() + 24 * 60 * 60 * 1000);
  try {
    await Sharing.shareAsync(file.uri, {
      dialogTitle: "LegendStream hesap yedeğini paylaş",
      mimeType: "application/octet-stream",
      UTI: "public.data",
    });
    return file.uri;
  } finally {
    await registerTempFile(file.uri, Date.now() + SHARE_GRACE_MS);
    scheduleGraceCleanup(file.uri);
  }
}

export type PickedProviderBackup = {
  bytes: Uint8Array;
  sourceName?: string;
  diagnostics: {
    documentPickerWaitMs: number;
    fileReadMs: number;
  };
  cleanup: () => Promise<void>;
};

export async function pickEncryptedProviderBackup(): Promise<PickedProviderBackup | null> {
  assertSecureEntropyAvailable();
  const pickerStartedAt = Date.now();
  const result = await DocumentPicker.getDocumentAsync({
    type: "*/*",
    multiple: false,
    copyToCacheDirectory: true,
  });
  const documentPickerWaitMs = Date.now() - pickerStartedAt;
  if (result.canceled) return null;
  const asset = result.assets[0];
  if (!asset) throw new Error("Selected backup file is unavailable.");
  if (typeof asset.size === "number" && asset.size > MAX_BACKUP_FILE_BYTES) {
    throw new Error("Selected backup file is too large.");
  }
  const file = new File(asset.uri);
  const fileReadStartedAt = Date.now();
  const bytes = await file.bytes();
  const fileReadMs = Date.now() - fileReadStartedAt;
  if (bytes.length > MAX_BACKUP_FILE_BYTES) throw new Error("Selected backup file is too large.");
  let cleaned = false;
  return {
    bytes,
    sourceName: asset.name,
    diagnostics: { documentPickerWaitMs, fileReadMs },
    cleanup: async () => {
      if (cleaned) return;
      cleaned = true;
      // copyToCacheDirectory creates a private cache copy on Android/iOS. Never
      // delete an original user document if a platform returns a non-cache URI.
      if (file.uri.startsWith(Paths.cache.uri) && file.exists) file.delete();
    },
  };
}
