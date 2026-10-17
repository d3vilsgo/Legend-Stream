/** Shared Gen2/XPlayer token lives ONLY in an access-controlled server secret store.
 * This module contains no token value, secret lookup, client credential or automatic network call. */
export const tmdbAccessDecision = {
  tokenPolicy: "reuse-existing-gen2-token-on-server",
  clientTokenAllowed: false,
  directTmdbAllowed: false,
} as const;
export type TmdbProxyConfiguration = Readonly<{
  origin?: string;
  authenticatedSessionAvailable: boolean;
}>;
export function evaluateTmdbProxy(
  config: TmdbProxyConfiguration,
):
  | "not-configured"
  | "invalid-origin"
  | "authentication-required"
  | "adapter-required" {
  if (!config.origin) return "not-configured";
  try {
    const url = new URL(config.origin);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== "/" ||
      /^(?:localhost|127\.|0\.|\[::1\])/iu.test(url.hostname)
    )
      return "invalid-origin";
  } catch {
    return "invalid-origin";
  }
  return config.authenticatedSessionAvailable
    ? "adapter-required"
    : "authentication-required";
}
