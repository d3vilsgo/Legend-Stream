export type ImportConflictChoice = "overwrite" | "keep_both" | "skip";

export type ImportTargetResolution = {
  sourceId: string;
  targetId: string | null;
  overwrite: boolean;
  skipped: boolean;
};

export function resolveImportTargets(
  incomingIds: readonly string[],
  currentIds: ReadonlySet<string>,
  choices: Readonly<Record<string, ImportConflictChoice>>,
  allocateId: (occupied: ReadonlySet<string>) => string,
): ImportTargetResolution[] {
  const occupied = new Set(currentIds);
  for (const id of incomingIds) occupied.add(id);
  return incomingIds.map((sourceId) => {
    if (!currentIds.has(sourceId)) {
      return { sourceId, targetId: sourceId, overwrite: false, skipped: false };
    }
    const choice = choices[sourceId];
    if (!choice) throw new Error("Every provider ID conflict must be resolved before import.");
    if (choice === "skip") {
      return { sourceId, targetId: null, overwrite: false, skipped: true };
    }
    if (choice === "overwrite") {
      return { sourceId, targetId: sourceId, overwrite: true, skipped: false };
    }
    for (let attempt = 0; attempt < 16; attempt += 1) {
      const targetId = allocateId(occupied);
      if (targetId && !occupied.has(targetId)) {
        occupied.add(targetId);
        return { sourceId, targetId, overwrite: false, skipped: false };
      }
    }
    throw new Error("Unable to allocate a unique imported provider ID.");
  });
}
