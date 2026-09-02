import type { ProviderType } from "./iptv";
import { isXtreamCatalogFallbackError } from "./xtreamCatalogErrors";

export type LegacyCatalogFallbackProvider = {
  type: ProviderType;
  url?: string;
  playlistUrl?: string;
};

function isCredentialedGetPhpSource(value: string | undefined) {
  if (!value) return false;
  try {
    const url = new URL(value);
    return (
      /\/get\.php$/i.test(url.pathname) &&
      Boolean(url.searchParams.get("username")) &&
      Boolean(url.searchParams.get("password"))
    );
  } catch {
    return false;
  }
}

export function shouldFallbackLegacyXtreamCatalogToM3U(
  provider: LegacyCatalogFallbackProvider,
  error: unknown,
) {
  return (
    provider.type === "xtream" &&
    (isCredentialedGetPhpSource(provider.playlistUrl) ||
      isCredentialedGetPhpSource(provider.url)) &&
    isXtreamCatalogFallbackError(error)
  );
}

export class LegacyCatalogFallbackAttemptGuard {
  private readonly attemptedProviderIds = new Set<string>();

  tryStart(providerId: string) {
    if (!providerId || this.attemptedProviderIds.has(providerId)) return false;
    this.attemptedProviderIds.add(providerId);
    return true;
  }

  clear(providerId: string) {
    this.attemptedProviderIds.delete(providerId);
  }
}
