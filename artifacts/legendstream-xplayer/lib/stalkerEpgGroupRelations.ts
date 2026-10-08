// Diagnostic only: fixed aggregate buckets, no identity values leave this module.
export const GROUP_RELATIONS = ["key_vs_ch_id", "key_vs_real_id", "key_vs_row_id", "ch_id_vs_real_id", "ch_id_vs_row_id", "real_id_vs_row_id"] as const;
export const GROUP_CONSTANTS = ["ch_id", "real_id", "row_id"] as const;
type Relation = typeof GROUP_RELATIONS[number];
type Field = typeof GROUP_CONSTANTS[number];
type Counts = { ALL: number; SOME: number; NONE: number; UNKNOWN: number };
const object = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const own = (value: Record<string, unknown>, key: string) => Object.hasOwn(value, key) ? value[key] : undefined;
// Physical fields were strings. No numeric conversion, trimming or ID transforms.
const identifier = (value: unknown) => typeof value === "string" && value.length > 0 ? value : undefined;
function confidence(counts: Counts, complete: boolean) {
  if (counts.SOME || (counts.ALL && counts.NONE)) return "MIXED";
  if (!counts.ALL && !counts.NONE) return "UNKNOWN";
  return complete
    ? counts.ALL ? "GLOBAL_ALL_OBSERVED" : "GLOBAL_NONE_OBSERVED"
    : counts.ALL ? "BOUNDED_ALL_OBSERVED" : "BOUNDED_NONE_OBSERVED";
}

export function inspectStalkerEpgGroupRelations(payload: unknown) {
  const root = object(payload);
  const container = object(root && Object.hasOwn(root, "data") ? root.data : payload);
  const relations = Object.fromEntries(GROUP_RELATIONS.map((key) => [key, { ALL: 0, SOME: 0, NONE: 0, UNKNOWN: 0 }])) as Record<Relation, Counts>;
  const constants = Object.fromEntries(GROUP_CONSTANTS.map((key) => [key, { YES: 0, NO: 0, UNKNOWN: 0 }])) as Record<Field, { YES: number; NO: number; UNKNOWN: number }>;
  let groups = 0;
  let rows = 0;
  let complete = Boolean(container);
  if (container) for (const key in container) {
    if (!Object.hasOwn(container, key)) continue;
    if (groups >= 1024 || rows >= 4096) { complete = false; break; }
    groups++;
    const values = container[key];
    const comparisons = GROUP_RELATIONS.map(() => ({ equal: 0, unequal: 0 }));
    const first: (string | undefined)[] = [undefined, undefined, undefined];
    const varying = [false, false, false];
    if (Array.isArray(values)) {
      const limit = Math.min(values.length, 256, 4096 - rows);
      if (limit < values.length) complete = false;
      for (let index = 0; index < limit; index++) {
        rows++;
        const row = object(values[index]);
        const ids = ["ch_id", "real_id", "id"].map((field) => row ? identifier(own(row, field)) : undefined);
        const [ch, real, id] = ids;
        const pairs = [[identifier(key), ch], [identifier(key), real], [identifier(key), id], [ch, real], [ch, id], [real, id]];
        pairs.forEach(([left, right], i) => {
          if (left !== undefined && right !== undefined) comparisons[i][left === right ? "equal" : "unequal"]++;
        });
        ids.forEach((value, i) => {
          if (value === undefined) return;
          if (first[i] === undefined) first[i] = value;
          else if (first[i] !== value) varying[i] = true;
        });
      }
    } else {
      // A nested/non-array value was not traversed; never claim full coverage.
      complete = false;
    }
    GROUP_RELATIONS.forEach((field, i) => {
      const { equal, unequal } = comparisons[i];
      relations[field][equal ? unequal ? "SOME" : "ALL" : unequal ? "NONE" : "UNKNOWN"]++;
    });
    GROUP_CONSTANTS.forEach((field, i) => {
      constants[field][first[i] === undefined ? "UNKNOWN" : varying[i] ? "NO" : "YES"]++;
    });
  }
  return {
    scope: complete ? "COMPLETE" : "BOUNDED", groups, rows,
    relations: Object.fromEntries(GROUP_RELATIONS.map((field) => [field, {
      ...relations[field], classification: confidence(relations[field], complete),
    }])) as Record<Relation, Counts & { classification: ReturnType<typeof confidence> }>,
    constants,
  };
}
