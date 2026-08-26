import type { ProviderImportCommitDiagnostics } from "./providerBackupService";
import type { ImportMemoryMetrics } from "../modules/legendstream-diagnostics";

export type ImportConflictChoiceCounts = {
  overwrite: number;
  keepBoth: number;
  skip: number;
};

export type ProviderImportMetricsReport = {
  schemaVersion: 2;
  generatedAt: string;
  status: "success" | "error";
  candidateCount: number;
  conflictCount: number;
  choices: ImportConflictChoiceCounts;
  durations: {
    documentPickerWaitMs: number;
    passwordEntryWaitMs: number;
    fileReadMs: number;
    unlockTotalMs: number;
    kdfMs: number;
    decryptAndParseOtherMs: number;
    conflictDecisionWaitMs: number;
    conflictUiReadyMs: number;
    planBuildMs: number;
    snapshotTotalMs: number;
    rootSnapshotReadMs: number;
    credentialSnapshotReadTotalMs: number;
    extensionSnapshotReadTotalMs: number;
    credentialWriteTotalMs: number;
    credentialVerifyReadTotalMs: number;
    extensionWriteTotalMs: number;
    extensionVerifyReadTotalMs: number;
    rootWriteMs: number;
    rootVerifyReadMs: number;
    metadataPrepareMs: number;
    metadataAsyncStorageWriteMs: number;
    metadataStateApplyMs: number;
    commitTotalMs: number;
    measuredFlowToFinishMs: number;
    totalExcludingConflictDecisionWaitMs: number;
  };
  calls: ProviderImportCommitDiagnostics["calls"];
  memory: ImportMemoryMetrics;
  providers: ProviderImportCommitDiagnostics["providers"];
};

export type ProviderImportMetricsInput = {
  status: "success" | "error";
  candidateCount: number;
  conflictCount: number;
  choices: ImportConflictChoiceCounts;
  documentPickerWaitMs: number;
  passwordEntryWaitMs: number;
  fileReadMs: number;
  unlockTotalMs: number;
  kdfMs: number;
  conflictDecisionWaitMs: number;
  conflictUiReadyMs: number;
  planBuildMs: number;
  measuredFlowToFinishMs: number;
  memory: ImportMemoryMetrics;
  commit: ProviderImportCommitDiagnostics;
};

const sum = (values: readonly number[]) =>
  values.reduce((total, value) => total + value, 0);

export function createProviderImportMetricsReport(
  input: ProviderImportMetricsInput,
): ProviderImportMetricsReport {
  const providers = input.commit.providers.map((provider) => ({
    index: provider.index,
    credentialSnapshotReadMs: provider.credentialSnapshotReadMs,
    extensionSnapshotReadMs: provider.extensionSnapshotReadMs,
    credentialWriteMs: provider.credentialWriteMs,
    credentialVerifyReadMs: provider.credentialVerifyReadMs,
    extensionWriteMs: provider.extensionWriteMs,
    extensionVerifyReadMs: provider.extensionVerifyReadMs,
  }));
  return {
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    status: input.status,
    candidateCount: input.candidateCount,
    conflictCount: input.conflictCount,
    choices: { ...input.choices },
    durations: {
      documentPickerWaitMs: input.documentPickerWaitMs,
      passwordEntryWaitMs: input.passwordEntryWaitMs,
      fileReadMs: input.fileReadMs,
      unlockTotalMs: input.unlockTotalMs,
      kdfMs: input.kdfMs,
      decryptAndParseOtherMs: Math.max(0, input.unlockTotalMs - input.kdfMs),
      conflictDecisionWaitMs: input.conflictDecisionWaitMs,
      conflictUiReadyMs: input.conflictUiReadyMs,
      planBuildMs: input.planBuildMs,
      snapshotTotalMs: input.commit.snapshotTotalMs,
      rootSnapshotReadMs: input.commit.rootSnapshotReadMs,
      credentialSnapshotReadTotalMs: sum(providers.map((item) => item.credentialSnapshotReadMs)),
      extensionSnapshotReadTotalMs: sum(providers.map((item) => item.extensionSnapshotReadMs)),
      credentialWriteTotalMs: sum(providers.map((item) => item.credentialWriteMs)),
      credentialVerifyReadTotalMs: sum(providers.map((item) => item.credentialVerifyReadMs)),
      extensionWriteTotalMs: sum(providers.map((item) => item.extensionWriteMs)),
      extensionVerifyReadTotalMs: sum(providers.map((item) => item.extensionVerifyReadMs)),
      rootWriteMs: input.commit.rootWriteMs,
      rootVerifyReadMs: input.commit.rootVerifyReadMs,
      metadataPrepareMs: input.commit.metadata.prepareMs,
      metadataAsyncStorageWriteMs: input.commit.metadata.asyncStorageWriteMs,
      metadataStateApplyMs: input.commit.metadata.stateApplyMs,
      commitTotalMs: input.commit.commitTotalMs,
      measuredFlowToFinishMs: input.measuredFlowToFinishMs,
      totalExcludingConflictDecisionWaitMs: Math.max(
        0,
        input.measuredFlowToFinishMs - input.conflictDecisionWaitMs,
      ),
    },
    calls: { ...input.commit.calls },
    memory: {
      available: input.memory.available,
      processingPeakPssKb: input.memory.processingPeakPssKb,
      kdfPeakPssKb: input.memory.kdfPeakPssKb,
      commitPeakPssKb: input.memory.commitPeakPssKb,
      decisionPeakPssKb: input.memory.decisionPeakPssKb,
      sampleCount: input.memory.sampleCount,
      sampleIntervalMs: input.memory.sampleIntervalMs,
    },
    providers,
  };
}

export function formatProviderImportMetrics(report: ProviderImportMetricsReport): string {
  const { durations: d, calls: c } = report;
  const lines = [
    "LegendStream provider import metrics v2",
    `generated_at=${report.generatedAt}`,
    `status=${report.status}`,
    `candidate_count=${report.candidateCount}`,
    `conflict_count=${report.conflictCount}`,
    `choice_overwrite_count=${report.choices.overwrite}`,
    `choice_keep_both_count=${report.choices.keepBoth}`,
    `choice_skip_count=${report.choices.skip}`,
    `document_picker_wait_ms=${d.documentPickerWaitMs}`,
    `password_entry_wait_ms=${d.passwordEntryWaitMs}`,
    `file_read_ms=${d.fileReadMs}`,
    `unlock_total_ms=${d.unlockTotalMs}`,
    `kdf_ms=${d.kdfMs}`,
    `decrypt_parse_other_ms=${d.decryptAndParseOtherMs}`,
    `conflict_decision_wait_ms=${d.conflictDecisionWaitMs}`,
    `conflict_ui_ready_ms=${d.conflictUiReadyMs}`,
    `plan_build_ms=${d.planBuildMs}`,
    `snapshot_total_ms=${d.snapshotTotalMs}`,
    `root_snapshot_read_ms=${d.rootSnapshotReadMs}`,
    `credential_snapshot_read_total_ms=${d.credentialSnapshotReadTotalMs}`,
    `extension_snapshot_read_total_ms=${d.extensionSnapshotReadTotalMs}`,
    `credential_write_total_ms=${d.credentialWriteTotalMs}`,
    `credential_verify_read_total_ms=${d.credentialVerifyReadTotalMs}`,
    `extension_write_total_ms=${d.extensionWriteTotalMs}`,
    `extension_verify_read_total_ms=${d.extensionVerifyReadTotalMs}`,
    `root_write_ms=${d.rootWriteMs}`,
    `root_verify_read_ms=${d.rootVerifyReadMs}`,
    `metadata_prepare_ms=${d.metadataPrepareMs}`,
    `metadata_asyncstorage_write_ms=${d.metadataAsyncStorageWriteMs}`,
    `metadata_state_apply_ms=${d.metadataStateApplyMs}`,
    `commit_total_ms=${d.commitTotalMs}`,
    `measured_flow_to_finish_ms=${d.measuredFlowToFinishMs}`,
    `total_excluding_conflict_decision_wait_ms=${d.totalExcludingConflictDecisionWaitMs}`,
    `call_credential_read=${c.credentialRead}`,
    `call_credential_write=${c.credentialWrite}`,
    `call_extension_read=${c.extensionRead}`,
    `call_extension_write=${c.extensionWrite}`,
    `call_root_read=${c.rootRead}`,
    `call_root_write=${c.rootWrite}`,
    `call_asyncstorage_write=${c.asyncStorageWrite}`,
    `memory_available=${report.memory.available}`,
    `peak_memory_pss_kb=${report.memory.processingPeakPssKb}`,
    `peak_memory_pss_mb=${(report.memory.processingPeakPssKb / 1024).toFixed(1)}`,
    `kdf_peak_memory_pss_kb=${report.memory.kdfPeakPssKb}`,
    `kdf_peak_memory_pss_mb=${(report.memory.kdfPeakPssKb / 1024).toFixed(1)}`,
    `commit_peak_memory_pss_kb=${report.memory.commitPeakPssKb}`,
    `commit_peak_memory_pss_mb=${(report.memory.commitPeakPssKb / 1024).toFixed(1)}`,
    `conflict_decision_peak_memory_pss_kb=${report.memory.decisionPeakPssKb}`,
    `memory_sample_count=${report.memory.sampleCount}`,
    `memory_sample_interval_ms=${report.memory.sampleIntervalMs}`,
  ];

  for (const provider of report.providers) {
    lines.push(
      `provider[${provider.index}]: credential_snapshot_read_ms=${provider.credentialSnapshotReadMs}; ` +
      `extension_snapshot_read_ms=${provider.extensionSnapshotReadMs}; ` +
      `credential_write_ms=${provider.credentialWriteMs}; ` +
      `credential_verify_read_ms=${provider.credentialVerifyReadMs}; ` +
      `extension_write_ms=${provider.extensionWriteMs}; ` +
      `extension_verify_read_ms=${provider.extensionVerifyReadMs}`,
    );
  }

  return lines.join("\n");
}
