export type EliteV4Direction = "left" | "right" | "up" | "down";
export type EliteV4Region = "sidebar" | "content" | "player";
export type EliteV4FocusNode = Readonly<{
  id: string;
  region: EliteV4Region;
  neighbors: Partial<Record<EliteV4Direction, string>>;
}>;

export function resolveEliteV4Target(
  node: EliteV4FocusNode | null | undefined,
  direction: EliteV4Direction,
): string | null {
  if (!node) return null;
  return node.neighbors[direction] ?? null;
}

export function isEliteV4FocusNodeVisible(
  nodeId: string,
  visibleIds: ReadonlySet<string>,
): boolean {
  return visibleIds.has(nodeId);
}
