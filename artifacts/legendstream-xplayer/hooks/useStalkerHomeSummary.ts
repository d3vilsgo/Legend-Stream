import { useEffect, useMemo, useState } from "react";
import {
  emptyStalkerHomeSummary,
  readStalkerHomeSummary,
  subscribeStalkerHomeSummary,
  type StalkerHomeSummary,
} from "@/lib/stalkerHomeSummary";
import type { XtreamSeriesItem, XtreamVodItem } from "@/lib/xtreamCatalog";

export function useStalkerHomeSummary(providerId?: string) {
  const [summary, setSummary] = useState<StalkerHomeSummary>(() => emptyStalkerHomeSummary(providerId ?? ""));

  useEffect(() => {
    let active = true;
    setSummary(emptyStalkerHomeSummary(providerId ?? ""));
    if (!providerId) return () => { active = false; };
    const unsubscribe = subscribeStalkerHomeSummary(providerId, (next) => {
      if (active) setSummary(next);
    });
    void readStalkerHomeSummary(providerId)
      .then((next) => { if (active) setSummary(next); })
      .catch(() => undefined);
    return () => {
      active = false;
      unsubscribe();
    };
  }, [providerId]);

  return useMemo(() => {
    const current = summary.providerId === (providerId ?? "")
      ? summary
      : emptyStalkerHomeSummary(providerId ?? "");
    return {
      movies: current.movies.map<XtreamVodItem>((item) => ({
        stream_id: item.id,
        name: item.title,
        stream_icon: item.image,
        genre: item.category,
        releaseDate: item.year,
        rating: item.rating,
      })),
      series: current.series.map<XtreamSeriesItem>((item) => ({
        series_id: item.id,
        name: item.title,
        cover: item.image,
        genre: item.category,
        releaseDate: item.year,
        rating: item.rating,
      })),
    };
  }, [providerId, summary]);
}
