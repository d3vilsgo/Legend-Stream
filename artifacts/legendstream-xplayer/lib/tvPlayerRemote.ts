export type TvRemoteAction = "reveal" | "togglePause" | "exit" | "codec" | "previous" | "next" | "seekBack" | "seekForward" | "none";
export function resolveTvRemoteAction(key: string, code: number, live: boolean, paused: boolean, visible: boolean): TvRemoteAction {
  if (key === "playPause") return (code === 126 && !paused || code === 127 && paused) ? "none" : "togglePause";
  if (key === "stop") return "exit";
  if (key === "menu") return "codec";
  if (key === "select") return visible ? "none" : "reveal";
  if (key === "previous" || live && key === "up") return "previous";
  if (key === "next" || live && key === "down") return "next";
  if (!live && key === "left") return "seekBack";
  if (!live && key === "right") return "seekForward";
  return visible ? "none" : "reveal";
}
