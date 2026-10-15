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

export type PlayerBackSnapshot = { panel: boolean; controls: boolean };
/** Advances synchronously so consecutive native Back presses do not reuse a stale React render. */
export function advancePlayerBack(state: PlayerBackSnapshot, nativeTv: boolean): "panel" | "controls" | "exit" {
  const target=resolvePlayerBack(state.panel,nativeTv && state.controls);
  if(target==="panel") {state.panel=false;state.controls=true;}
  else if(target==="controls") state.controls=false;
  return target;
}
