import type { Provider, ProviderLoadResult } from "./iptv";
import { persistM3UProviderCache } from "./m3uCatalogCache";
import { enqueueM3UCacheWrite } from "./m3uCacheWriteQueue";
import { safeLog } from "./safeLog";

export function persistM3ULoadInBackground(
  provider: Provider,
  loaded: ProviderLoadResult,
  isCurrent?: () => boolean,
) {
  if (provider.type !== "m3u") return null;
  return enqueueM3UCacheWrite(async () => {
    try {
      if (isCurrent && !isCurrent()) return false;
      const persisted = await persistM3UProviderCache(provider, loaded, isCurrent);
      if (!persisted) {
        safeLog.warn("LS_M3U_CACHE_WRITE", { result: "rejected" });
      }
      return persisted;
    } catch (caught) {
      safeLog.error("LS_M3U_CACHE_WRITE", caught);
      return false;
    }
  });
}
