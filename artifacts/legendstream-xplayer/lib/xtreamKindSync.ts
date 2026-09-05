export type XtreamCatalogKind = "live" | "vod" | "series";
export type XtreamKindOutcome = "success" | "failed" | "skipped";

export type XtreamKindTask = {
  kind: XtreamCatalogKind;
  run: () => Promise<void>;
};

export type XtreamKindSyncResult = Record<XtreamCatalogKind, XtreamKindOutcome> & {
  cancelled: boolean;
};

export async function runIndependentCatalogKinds(
  tasks: readonly XtreamKindTask[],
  options: { isCancelled?: () => boolean } = {},
): Promise<XtreamKindSyncResult> {
  const result: XtreamKindSyncResult = {
    live: "skipped",
    vod: "skipped",
    series: "skipped",
    cancelled: false,
  };

  for (const task of tasks) {
    if (options.isCancelled?.()) {
      result.cancelled = true;
      break;
    }
    try {
      await task.run();
      if (options.isCancelled?.()) {
        result.cancelled = true;
        break;
      }
      result[task.kind] = "success";
    } catch {
      if (options.isCancelled?.()) {
        result.cancelled = true;
        break;
      }
      result[task.kind] = "failed";
    }
  }

  return result;
}
