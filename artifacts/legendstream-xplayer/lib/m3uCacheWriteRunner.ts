import type { Provider, ProviderLoadResult } from "./iptv";
import { persistM3UProviderCache } from "./m3uCatalogCache";
import { safeLog } from "./safeLog";

export function persistM3ULoadInBackground(
  provider: Provider,
  loaded: ProviderLoadResult,
) {
  if (provider.type !== "m3u") return;
  void (async () => {
    try {
      const persisted = await persistM3UProviderCache(provider, loaded);
      if (!persisted) {
        safeLog.warn("LS_M3U_CACHE_WRITE", { result: "rejected" });
      }
    } catch (caught) {
      safeLog.error("LS_M3U_CACHE_WRITE", caught);
    }
  })();
}
