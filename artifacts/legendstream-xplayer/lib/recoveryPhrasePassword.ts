import { normalizeBackupPassword } from "./providerBackupCore";

export function normalizeRecoveryPhrasePassword(password: string): string {
  const normalized = password
    .normalize("NFKC")
    .trim()
    .replace(/\s+/gu, " ")
    .toLowerCase();
  return normalizeBackupPassword(normalized);
}
