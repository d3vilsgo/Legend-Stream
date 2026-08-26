import * as ExpoCrypto from "expo-crypto";

let entropyBootstrapError: Error | null = null;

type RandomValues = <T extends ArrayBufferView | null>(array: T) => T;

function asError(error: unknown, fallback: string) {
  return error instanceof Error ? error : new Error(fallback);
}

function installGetRandomValues() {
  try {
    if (typeof ExpoCrypto.getRandomValues !== "function") {
      throw new Error("expo-crypto getRandomValues is unavailable.");
    }
    const target = globalThis as typeof globalThis & {
      crypto?: Crypto;
    };
    if (!target.crypto) {
      Object.defineProperty(target, "crypto", {
        configurable: true,
        enumerable: false,
        writable: true,
        value: { getRandomValues: ExpoCrypto.getRandomValues as RandomValues } as Crypto,
      });
    } else if (typeof target.crypto.getRandomValues !== "function") {
      Object.defineProperty(target.crypto, "getRandomValues", {
        configurable: true,
        enumerable: false,
        writable: true,
        value: ExpoCrypto.getRandomValues as RandomValues,
      });
    }
    const probe = new Uint8Array(1);
    ExpoCrypto.getRandomValues(probe);
  } catch (error) {
    entropyBootstrapError = asError(error, "Secure random entropy bootstrap failed.");
  }
}

installGetRandomValues();

export function assertSecureEntropyAvailable(): void {
  if (entropyBootstrapError) throw entropyBootstrapError;
  if (typeof ExpoCrypto.getRandomValues !== "function") {
    throw new Error("Secure random entropy is unavailable.");
  }
  const probe = new Uint8Array(1);
  try {
    ExpoCrypto.getRandomValues(probe);
  } catch (error) {
    throw asError(error, "Secure random entropy is unavailable.");
  }
}

export function secureRandomBytes(length: number): Uint8Array {
  assertSecureEntropyAvailable();
  if (!Number.isSafeInteger(length) || length < 1 || length > 4096) {
    throw new RangeError("Secure random byte length is invalid.");
  }
  const bytes = new Uint8Array(length);
  ExpoCrypto.getRandomValues(bytes);
  return bytes;
}
