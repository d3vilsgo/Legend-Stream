import assert from "node:assert/strict";
import {
  CRYPTO_UNAVAILABLE_MESSAGE,
  cryptoAvailable,
  decryptBackupFile,
  encryptBackupPayload,
  type BackupPayloadV1,
} from "../lib/providerBackupCore";

const payload: BackupPayloadV1 = {
  schema_version: 1,
  exported_at: "2026-08-26T12:00:00.000Z",
  providers: [],
};

async function expectCryptoUnavailable(promise: Promise<unknown>) {
  try {
    await promise;
    assert.fail("expected crypto runtime rejection");
  } catch (error) {
    assert(error instanceof Error, `expected Error, got ${String(error)}`);
    assert.equal(error.message, CRYPTO_UNAVAILABLE_MESSAGE);
  }
}

async function main() {
  // Reaching main proves the module loaded without a startup throw.
  assert.equal(cryptoAvailable, false, "mocked Noble export must mark crypto unavailable");

  let secureStoreWrites = 0;
  let asyncStorageWrites = 0;

  const exportThenPersist = async () => {
    await encryptBackupPayload(
      payload,
      "degraded-mode-password",
      (length) => new Uint8Array(length),
    );
    secureStoreWrites += 1;
    asyncStorageWrites += 1;
  };

  const importThenPersist = async () => {
    await decryptBackupFile(new Uint8Array([0x7b]), "degraded-mode-password");
    secureStoreWrites += 1;
    asyncStorageWrites += 1;
  };

  await expectCryptoUnavailable(exportThenPersist());
  await expectCryptoUnavailable(importThenPersist());

  assert.equal(secureStoreWrites, 0, "SecureStore writes must remain zero when crypto is unavailable");
  assert.equal(asyncStorageWrites, 0, "AsyncStorage writes must remain zero when crypto is unavailable");

  console.log(
    `degraded-mode: module-load=pass cryptoAvailable=${cryptoAvailable} secureStoreWrites=${secureStoreWrites} asyncStorageWrites=${asyncStorageWrites}`,
  );
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
