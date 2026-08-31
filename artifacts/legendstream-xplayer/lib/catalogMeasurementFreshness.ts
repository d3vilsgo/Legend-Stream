export type CatalogMeasurementState = "completed" | "in-progress";

export type CatalogMeasurementMetadata = {
  startedAt: number;
  recordedAt: number;
  sequence: number;
  state: CatalogMeasurementState;
};

export type CatalogMeasurementInProgress = {
  startedAt: number;
};

let activeMeasurement: CatalogMeasurementInProgress | null = null;

export function beginCatalogMeasurementFreshness(startedAt: number) {
  activeMeasurement = {
    startedAt: Math.max(0, Math.trunc(startedAt)),
  };
}

export function completeCatalogMeasurementFreshness(startedAt?: number) {
  if (!activeMeasurement) return;
  if (startedAt !== undefined && activeMeasurement.startedAt !== Math.max(0, Math.trunc(startedAt))) return;
  activeMeasurement = null;
}

export function getCatalogMeasurementInProgress(): CatalogMeasurementInProgress | null {
  return activeMeasurement ? { ...activeMeasurement } : null;
}

export function formatCatalogMeasurementMetadata(metadata: CatalogMeasurementMetadata) {
  return [
    `measurement.startedAt=${metadata.startedAt}`,
    `measurement.recordedAt=${metadata.recordedAt}`,
    `measurement.sequence=${metadata.sequence}`,
    `measurement.state=${metadata.state}`,
  ].join("\n");
}

export type CatalogMeasurementDisplay<T> =
  | {
      state: "in-progress";
      metadata: CatalogMeasurementMetadata;
      measurement: null;
    }
  | {
      state: "completed";
      metadata: CatalogMeasurementMetadata;
      measurement: T;
    }
  | {
      state: "empty";
      metadata: null;
      measurement: null;
    };

export function resolveCatalogMeasurementDisplay<T extends CatalogMeasurementMetadata>(
  active: CatalogMeasurementInProgress | null,
  completed: T | null,
  nextSequence: number,
): CatalogMeasurementDisplay<T> {
  if (active) {
    return {
      state: "in-progress",
      metadata: {
        startedAt: active.startedAt,
        recordedAt: 0,
        sequence: Math.max(1, Math.trunc(nextSequence)),
        state: "in-progress",
      },
      measurement: null,
    };
  }
  if (!completed) return { state: "empty", metadata: null, measurement: null };
  return {
    state: "completed",
    metadata: {
      startedAt: completed.startedAt,
      recordedAt: completed.recordedAt,
      sequence: completed.sequence,
      state: "completed",
    },
    measurement: completed,
  };
}
