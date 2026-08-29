import { redactSensitiveText } from "./safeLog";

export type ProviderSwitchPath = "memory" | "cache" | "network";

export function chooseProviderSwitchPath(options: {
  hasInMemoryChannels: boolean;
  hasUsableCatalogCache: boolean;
}): ProviderSwitchPath {
  if (options.hasInMemoryChannels) return "memory";
  if (options.hasUsableCatalogCache) return "cache";
  return "network";
}

export function tryBeginProviderSwitch(
  currentProviderId: string | null,
  targetProviderId: string,
) {
  if (currentProviderId) {
    return { started: false as const, providerId: currentProviderId };
  }
  return { started: true as const, providerId: targetProviderId };
}

export function safeProviderSwitchError(caught: unknown) {
  const message = caught instanceof Error
    ? caught.message
    : "The saved provider could not be opened.";
  return redactSensitiveText(message);
}

export function shouldPreserveProviderSwitchSnapshot(options: {
  snapshotProviderId?: string;
  targetProviderId?: string;
  hasUsableCache: boolean;
}) {
  return Boolean(
    options.targetProviderId &&
    options.snapshotProviderId === options.targetProviderId &&
    options.hasUsableCache,
  );
}
