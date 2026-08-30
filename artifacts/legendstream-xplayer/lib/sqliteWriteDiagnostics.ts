export const M3U_SQLITE_ERROR_CLASSES = [
  "SQLITE_BUSY",
  "SQLITE_LOCKED",
  "SQLITE_FULL",
  "SQLITE_IOERR",
  "SQLITE_CONSTRAINT",
  "SQLITE_READONLY",
  "SQLITE_CORRUPT",
  "SQLITE_NOMEM",
  "SQLITE_TOOBIG",
  "SQLITE_ERROR",
  "UNKNOWN",
] as const;

export type M3USqliteErrorClass = (typeof M3U_SQLITE_ERROR_CLASSES)[number];

export const M3U_SQLITE_STAGES = [
  "set-syncing",
  "upsert-live",
  "upsert-vod",
  "upsert-series",
  "replace-categories",
  "prune",
  "set-ready",
] as const;

export type M3USqliteStage = (typeof M3U_SQLITE_STAGES)[number];
export type M3UCacheAfterReadOutcome = "success" | "error";
export type M3USqliteWriteKind = "live" | "vod" | "series";
export type M3USqliteKindCounts = Record<M3USqliteWriteKind, number>;

export type M3USqliteErrorIdentity = {
  sqliteErrorClass: M3USqliteErrorClass;
  sqlitePrimaryCode: number;
};

const PRIMARY_CODE_BY_CLASS: Record<Exclude<M3USqliteErrorClass, "UNKNOWN">, number> = {
  SQLITE_ERROR: 1,
  SQLITE_BUSY: 5,
  SQLITE_LOCKED: 6,
  SQLITE_NOMEM: 7,
  SQLITE_READONLY: 8,
  SQLITE_IOERR: 10,
  SQLITE_CORRUPT: 11,
  SQLITE_FULL: 13,
  SQLITE_TOOBIG: 18,
  SQLITE_CONSTRAINT: 19,
};

const CLASS_BY_PRIMARY_CODE: Partial<Record<number, M3USqliteErrorClass>> = {
  1: "SQLITE_ERROR",
  5: "SQLITE_BUSY",
  6: "SQLITE_LOCKED",
  7: "SQLITE_NOMEM",
  8: "SQLITE_READONLY",
  10: "SQLITE_IOERR",
  11: "SQLITE_CORRUPT",
  13: "SQLITE_FULL",
  18: "SQLITE_TOOBIG",
  19: "SQLITE_CONSTRAINT",
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? value as Record<string, unknown> : null;
}

function primaryCodeFromNumber(value: unknown): number | null {
  const numeric = typeof value === "number"
    ? value
    : typeof value === "string" && /^\s*\d+\s*$/.test(value)
      ? Number(value)
      : Number.NaN;
  if (!Number.isFinite(numeric) || numeric < 0) return null;
  const integer = Math.trunc(numeric);
  return integer > 255 ? integer & 0xff : integer;
}

function classFromText(value: string): M3USqliteErrorClass | null {
  const upper = value.toUpperCase();
  for (const errorClass of M3U_SQLITE_ERROR_CLASSES) {
    if (errorClass !== "UNKNOWN" && upper.includes(errorClass)) return errorClass;
  }
  if (/DATABASE TABLE IS LOCKED|TABLE IS LOCKED/.test(upper)) return "SQLITE_LOCKED";
  if (/DATABASE IS LOCKED|DATABASE IS BUSY/.test(upper)) return "SQLITE_BUSY";
  if (/DATABASE OR DISK IS FULL|DISK IS FULL/.test(upper)) return "SQLITE_FULL";
  if (/DISK I\/O ERROR|I\/O ERROR/.test(upper)) return "SQLITE_IOERR";
  if (/READONLY DATABASE|READ-ONLY DATABASE/.test(upper)) return "SQLITE_READONLY";
  if (/DATABASE DISK IMAGE IS MALFORMED|DATABASE IS MALFORMED/.test(upper)) return "SQLITE_CORRUPT";
  if (/CONSTRAINT FAILED|CONSTRAINT VIOLATION/.test(upper)) return "SQLITE_CONSTRAINT";
  if (/OUT OF MEMORY/.test(upper)) return "SQLITE_NOMEM";
  if (/STRING OR BLOB TOO BIG|TOO BIG/.test(upper)) return "SQLITE_TOOBIG";
  return null;
}

function labeledCodeFromText(value: string): number | null {
  const match = value.match(/(?:sqlite|result|error)[ _-]?code\s*[:=]?\s*(\d+)/i);
  return match ? primaryCodeFromNumber(match[1]) : null;
}

export function classifyM3USqliteError(caught: unknown): M3USqliteErrorIdentity {
  const records = [asRecord(caught), asRecord(asRecord(caught)?.cause)].filter(
    (value): value is Record<string, unknown> => value !== null,
  );
  const values: unknown[] = [caught];
  for (const record of records) {
    values.push(
      record.code,
      record.sqliteCode,
      record.resultCode,
      record.errcode,
      record.name,
      record.message,
    );
  }

  for (const value of values) {
    const primaryCode = primaryCodeFromNumber(value);
    if (primaryCode === null) continue;
    const errorClass = CLASS_BY_PRIMARY_CODE[primaryCode];
    if (errorClass) return { sqliteErrorClass: errorClass, sqlitePrimaryCode: primaryCode };
  }

  for (const value of values) {
    if (typeof value !== "string") continue;
    const primaryCode = labeledCodeFromText(value);
    if (primaryCode !== null) {
      const errorClass = CLASS_BY_PRIMARY_CODE[primaryCode] ?? "UNKNOWN";
      return { sqliteErrorClass: errorClass, sqlitePrimaryCode: primaryCode };
    }
    const errorClass = classFromText(value);
    if (errorClass) {
      return {
        sqliteErrorClass: errorClass,
        sqlitePrimaryCode: PRIMARY_CODE_BY_CLASS[errorClass as Exclude<M3USqliteErrorClass, "UNKNOWN">],
      };
    }
  }

  return { sqliteErrorClass: "UNKNOWN", sqlitePrimaryCode: -1 };
}

export type M3USqliteBatchProgress = {
  completedBatchCount: M3USqliteKindCounts;
  committedRows: M3USqliteKindCounts;
  activeKind: M3USqliteWriteKind | null;
  activeBatchIndex: number;
};

function emptyKindCounts(): M3USqliteKindCounts {
  return { live: 0, vod: 0, series: 0 };
}

export function createM3USqliteBatchProgress(): M3USqliteBatchProgress {
  return {
    completedBatchCount: emptyKindCounts(),
    committedRows: emptyKindCounts(),
    activeKind: null,
    activeBatchIndex: 0,
  };
}

export function noteM3USqliteBatchStarted(
  progress: M3USqliteBatchProgress,
  kind: M3USqliteWriteKind,
  batchIndex: number,
) {
  progress.activeKind = kind;
  progress.activeBatchIndex = Math.max(1, Math.trunc(batchIndex));
}

export function noteM3USqliteBatchCommitted(
  progress: M3USqliteBatchProgress,
  kind: M3USqliteWriteKind,
  batchIndex: number,
  committedRows: number,
) {
  progress.completedBatchCount[kind] = Math.max(
    progress.completedBatchCount[kind],
    Math.max(1, Math.trunc(batchIndex)),
  );
  progress.committedRows[kind] = Math.max(
    progress.committedRows[kind],
    Math.max(0, Math.trunc(committedRows)),
  );
  progress.activeKind = null;
  progress.activeBatchIndex = 0;
}

export function failedM3USqliteBatchIndex(
  progress: M3USqliteBatchProgress,
  stage: M3USqliteStage,
) {
  if (!stage.startsWith("upsert-") || !progress.activeKind) return 0;
  return stage === `upsert-${progress.activeKind}` ? progress.activeBatchIndex : 0;
}

export function snapshotM3USqliteBatchProgress(progress: M3USqliteBatchProgress) {
  return {
    completedBatchCount: { ...progress.completedBatchCount },
    committedRows: { ...progress.committedRows },
  };
}
