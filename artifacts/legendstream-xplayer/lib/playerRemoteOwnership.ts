// Synchronous ownership prevents later catalog listeners from consuming player Back.
const owners = new Set<symbol>();
export const hasPlayerBackOwner = () => owners.size > 0;
export function claimPlayerBack() {
  const token = Symbol("player");
  owners.add(token);
  return () => { owners.delete(token); };
}
export function resolvePlayerBack(panel: boolean, controls: boolean): "panel" | "controls" | "exit" {
  return panel ? "panel" : controls ? "controls" : "exit";
}
