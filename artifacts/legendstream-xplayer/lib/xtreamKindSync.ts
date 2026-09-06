export type XtreamCatalogKind = "live" | "vod" | "series";
export type XtreamKindOutcome = "success" | "failed" | "skipped";

export type XtreamKindFailureDiagnostic = {
  stage: string;
  code: string;
  fallbackPath: string;
  errorClass: string;
};

export type XtreamKindTask = {
  kind: XtreamCatalogKind;
  run: () => Promise<void>;
};

export type XtreamKindSyncResult = Record<XtreamCatalogKind, XtreamKindOutcome> & {
  cancelled: boolean;
  failures: Partial<Record<XtreamCatalogKind, XtreamKindFailureDiagnostic>>;
};

const safeDiagnosticToken = (value: unknown, fallback: string) => {
  const text = typeof value === "string" ? value : "";
  return /^[A-Za-z0-9_.-]{1,64}$/.test(text) ? text : fallback;
};

function failureDiagnostic(caught: unknown): XtreamKindFailureDiagnostic {
  const tagged = caught && typeof caught === "object"
    ? caught as Record<string, unknown>
    : {};
  return {
    stage: safeDiagnosticToken(tagged.catalogStage, "kind"),
    code: safeDiagnosticToken(tagged.catalogCode, "UNEXPECTED"),
    fallbackPath: safeDiagnosticToken(tagged.fallbackPath, "none"),
    errorClass: safeDiagnosticToken(
      tagged.errorClass ?? (caught instanceof Error ? caught.name : undefined),
      "UnknownError",
    ),
  };
}

export async function runIndependentCatalogKinds(
  tasks: readonly XtreamKindTask[],
  options: { isCancelled?: () => boolean } = {},
): Promise<XtreamKindSyncResult> {
  const result: XtreamKindSyncResult = {
    live: "skipped",
    vod: "skipped",
    series: "skipped",
    cancelled: false,
    failures: {},
  };

  await Promise.all(tasks.map(async (task) => {
    if (options.isCancelled?.()) {
      result.cancelled = true;
      return;
    }
    try {
      await task.run();
      if (options.isCancelled?.()) {
        result.cancelled = true;
        return;
      }
      result[task.kind] = "success";
    } catch (caught) {
      if (options.isCancelled?.()) {
        result.cancelled = true;
        return;
      }
      result[task.kind] = "failed";
      result.failures[task.kind] = failureDiagnostic(caught);
    }
  }));

  if (options.isCancelled?.()) result.cancelled = true;
  return result;
}
