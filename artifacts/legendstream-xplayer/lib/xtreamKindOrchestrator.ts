import type { CatalogKind } from "./catalogPersistence";

export type XtreamKindSyncStatus = "published" | "preserved";

export type XtreamKindSyncOutcome = {
  kind: CatalogKind;
  status: XtreamKindSyncStatus;
  error?: unknown;
};

export type XtreamKindSyncTask = {
  kind: CatalogKind;
  run: () => Promise<XtreamKindSyncStatus>;
  cleanup: () => Promise<void>;
};

type IndependentKindSyncOptions = {
  tasks: XtreamKindSyncTask[];
  isCurrent: () => boolean;
  isCancelled: () => boolean;
};

export type IndependentKindSyncResult = {
  outcomes: XtreamKindSyncOutcome[];
  cancelled: boolean;
};

export async function runIndependentXtreamKindSync(
  options: IndependentKindSyncOptions,
): Promise<IndependentKindSyncResult> {
  const outcomes: XtreamKindSyncOutcome[] = [];

  for (const task of options.tasks) {
    if (!options.isCurrent() || options.isCancelled()) {
      return { outcomes, cancelled: true };
    }

    try {
      const status = await task.run();
      if (!options.isCurrent() || options.isCancelled()) {
        await task.cleanup();
        return { outcomes, cancelled: true };
      }
      outcomes.push({ kind: task.kind, status });
    } catch (error) {
      await task.cleanup();
      if (!options.isCurrent() || options.isCancelled()) {
        return { outcomes, cancelled: true };
      }
      outcomes.push({ kind: task.kind, status: "preserved", error });
    }
  }

  return { outcomes, cancelled: false };
}
