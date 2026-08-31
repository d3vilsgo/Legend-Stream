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

export const M3U_SQLITE_ERROR_REASONS = [
  "TOO_MANY_VARIABLES",
  "NO_SUCH_COLUMN",
  "NO_SUCH_TABLE",
  "COLUMN_VALUE_COUNT_MISMATCH",
  "ON_CONFLICT_MISMATCH",
  "TRANSACTION_ALREADY_ACTIVE",
  "NO_ACTIVE_TRANSACTION",
  "SQL_SYNTAX",
  "UNKNOWN_SQLITE_ERROR",
] as const;

export type M3USqliteErrorReason = (typeof M3U_SQLITE_ERROR_REASONS)[number];

export const M3U_SQLITE_TRANSACTION_STAGES = [
  "begin-transaction",
  "insert-statement",
  "commit",
] as const;

export type M3USqliteTransactionStage = (typeof M3U_SQLITE_TRANSACTION_STAGES)[number];

export const M3U_SQLITE_STAGES = [
  "set-syncing",
  ...M3U_SQLITE_TRANSACTION_STAGES,
  "replace-categories",
  "prune",
  "set-ready",
  // Legacy persisted values remain accepted so older measurements can still be read.
  "upsert-live",
  "upsert-vod",
  "upsert-series",
] as const;

export type M3USqliteStage = (typeof M3U_SQLITE_STAGES)[number];
export type M3UCacheAfterReadOutcome = "success" | "error";
export type M3USqliteWriteKind = "live" | "vod" | "series";
export type M3USqliteKindCounts = Record<M3USqliteWriteKind, number>;

export type M3USqliteErrorIdentity = {
  sqliteErrorClass: M3USqliteErrorClass;
  sqlitePrimaryCode: number;
  sqliteErrorReason: M3USqliteErrorReason;
};

export type M3USqliteSchemaFingerprint = {
  sqliteSchemaColumnCount: number;
  sqliteSchemaColumnNameHash: string;
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

function reasonFromText(value: string): M3USqliteErrorReason | null {
  const upper = value.toUpperCase();
  if (/TOO MANY (?:SQL )?VARIABLES/.test(upper)) return "TOO_MANY_VARIABLES";
  if (/NO SUCH COLUMN\b/.test(upper)) return "NO_SUCH_COLUMN";
  if (/NO SUCH TABLE\b/.test(upper)) return "NO_SUCH_TABLE";
  if (
    /\d+\s+VALUES?\s+FOR\s+\d+\s+COLUMNS?/.test(upper) ||
    /HAS\s+\d+\s+COLUMNS?\s+BUT\s+\d+\s+VALUES?\s+WERE\s+SUPPLIED/.test(upper) ||
    /EXPECTED\s+\d+\s+(?:VALUES?|COLUMNS?).*\bGOT\s+\d+/.test(upper)
  ) return "COLUMN_VALUE_COUNT_MISMATCH";
  if (/ON CONFLICT CLAUSE DOES NOT MATCH/.test(upper)) return "ON_CONFLICT_MISMATCH";
  if (/CANNOT START A TRANSACTION WITHIN A TRANSACTION|TRANSACTION ALREADY ACTIVE/.test(upper)) {
    return "TRANSACTION_ALREADY_ACTIVE";
  }
  if (/NO TRANSACTION IS ACTIVE|CANNOT (?:COMMIT|ROLLBACK).*TRANSACTION/.test(upper)) {
    return "NO_ACTIVE_TRANSACTION";
  }
  if (/SYNTAX ERROR/.test(upper)) return "SQL_SYNTAX";
  return null;
}

function labeledCodeFromText(value: string): number | null {
  const match = value.match(/(?:sqlite|result|error)[ _-]?code\s*[:=]?\s*(\d+)/i);
  return match ? primaryCodeFromNumber(match[1]) : null;
}

function classifyReason(values: unknown[]): M3USqliteErrorReason {
  for (const value of values) {
    if (typeof value !== "string") continue;
    const reason = reasonFromText(value);
    if (reason) return reason;
  }
  return "UNKNOWN_SQLITE_ERROR";
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
  const sqliteErrorReason = classifyReason(values);

  for (const value of values) {
    const primaryCode = primaryCodeFromNumber(value);
    if (primaryCode === null) continue;
    const errorClass = CLASS_BY_PRIMARY_CODE[primaryCode];
    if (errorClass) return { sqliteErrorClass: errorClass, sqlitePrimaryCode: primaryCode, sqliteErrorReason };
  }

  for (const value of values) {
    if (typeof value !== "string") continue;
    const primaryCode = labeledCodeFromText(value);
    if (primaryCode !== null) {
      const errorClass = CLASS_BY_PRIMARY_CODE[primaryCode] ?? "UNKNOWN";
      return { sqliteErrorClass: errorClass, sqlitePrimaryCode: primaryCode, sqliteErrorReason };
    }
    const errorClass = classFromText(value);
    if (errorClass) {
      return {
        sqliteErrorClass: errorClass,
        sqlitePrimaryCode: PRIMARY_CODE_BY_CLASS[errorClass as Exclude<M3USqliteErrorClass, "UNKNOWN">],
        sqliteErrorReason,
      };
    }
  }

  return { sqliteErrorClass: "UNKNOWN", sqlitePrimaryCode: -1, sqliteErrorReason };
}

export function fingerprintM3USqliteColumnNames(
  columnNames: readonly string[],
): M3USqliteSchemaFingerprint {
  const canonical = [...columnNames].sort((a, b) => a.localeCompare(b)).join("\u001f");
  let hash = 0x811c9dc5;
  for (let index = 0; index < canonical.length; index += 1) {
    hash ^= canonical.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return {
    sqliteSchemaColumnCount: columnNames.length,
    sqliteSchemaColumnNameHash: `fnv1a32:${hash.toString(16).padStart(8, "0")}`,
  };
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
  if (!progress.activeKind) return 0;
  if (M3U_SQLITE_TRANSACTION_STAGES.includes(stage as M3USqliteTransactionStage)) {
    return progress.activeBatchIndex;
  }
  return stage === `upsert-${progress.activeKind}` ? progress.activeBatchIndex : 0;
}

export function snapshotM3USqliteBatchProgress(progress: M3USqliteBatchProgress) {
  return {
    completedBatchCount: { ...progress.completedBatchCount },
    committedRows: { ...progress.committedRows },
  };
}
