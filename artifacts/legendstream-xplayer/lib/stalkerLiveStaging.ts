const STALKER_STAGING_PREFIX = "__staging__";
const STALKER_STAGING_MARKER = "__stalker_run__";

export function stalkerLiveStagingProviderId(providerId: string, runToken: string) {
  const provider = providerId.trim();
  const token = runToken.trim();
  if (!provider || !token) throw new Error("Stalker Live staging requires provider and run identity.");
  return `${STALKER_STAGING_PREFIX}${provider}${STALKER_STAGING_MARKER}${token}`;
}

export function assertStalkerLiveStagingTarget(providerId: string, stagingId: string) {
  const provider = providerId.trim();
  const expectedPrefix = `${STALKER_STAGING_PREFIX}${provider}${STALKER_STAGING_MARKER}`;
  if (!provider || !stagingId.startsWith(expectedPrefix) || stagingId.length === expectedPrefix.length) {
    throw new Error("Stalker Live staging target does not belong to this provider run.");
  }
}
