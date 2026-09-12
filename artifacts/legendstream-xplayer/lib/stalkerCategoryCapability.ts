import type { StalkerLiveCategory } from "./stalkerLiveCatalog";

const liveCategoriesByProvider = new Map<string, StalkerLiveCategory[]>();

export function rememberStalkerLiveCategories(providerId: string, categories: readonly StalkerLiveCategory[]) {
  liveCategoriesByProvider.set(providerId, categories.map((item) => ({ ...item })));
}

export function readRememberedStalkerLiveCategories(providerId: string) {
  return (liveCategoriesByProvider.get(providerId) ?? []).map((item) => ({ ...item }));
}

export function clearRememberedStalkerLiveCategories(providerId?: string) {
  if (providerId) liveCategoriesByProvider.delete(providerId);
  else liveCategoriesByProvider.clear();
}
