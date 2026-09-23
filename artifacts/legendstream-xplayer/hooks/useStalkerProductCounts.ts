import { useEffect, useState } from "react";
import {
  readStalkerProductCounts,
  subscribeStalkerProductCounts,
  type StalkerProductCounts,
} from "@/lib/stalkerProductCounts";

const EMPTY: StalkerProductCounts = { vod: null, series: null };

export function useStalkerProductCounts(providerId?: string) {
  const [counts, setCounts] = useState<StalkerProductCounts>(EMPTY);

  useEffect(() => {
    let active = true;
    setCounts(EMPTY);
    if (!providerId) return () => { active = false; };
    const unsubscribe = subscribeStalkerProductCounts(providerId, (next) => {
      if (active) setCounts(next);
    });
    void readStalkerProductCounts(providerId)
      .then((next) => { if (active) setCounts(next); })
      .catch(() => undefined);
    return () => {
      active = false;
      unsubscribe();
    };
  }, [providerId]);

  return counts;
}
