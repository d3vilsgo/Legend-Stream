import React from "react";
import { createRoot } from "react-dom/client";
import { EliteShowcase } from "../components/elite/EliteShowcase";
import { resolveTVPreviewFocusTarget } from "../lib/tvPreviewFocus";
import type { EliteMode } from "../lib/design/eliteTokens";
const modes: Record<
  string,
  { width: number; height: number; mode: EliteMode }
> = {
  tv540: { width: 960, height: 540, mode: "preview" },
  tv720: { width: 1280, height: 720, mode: "preview" },
  tv1080: { width: 1920, height: 1080, mode: "preview" },
  scaled4k: { width: 1536, height: 864, mode: "preview" },
  mobile: { width: 390, height: 844, mode: "mobile" },
  tablet: { width: 900, height: 1200, mode: "tablet" },
};
function Preview() {
  const [preset, setPreset] = React.useState("tv720");
  const [font, setFont] = React.useState(1);
  const [safe, setSafe] = React.useState(false);
  const p = modes[preset];
  return (
    <>
      <header>
        <div>
          <strong>
            LEGEND ELITE <small>V1</small>
          </strong>
          <span>Tasarım laboratuvarı · gerçek player değildir</span>
        </div>
        <nav>
          <label>
            Pencere{" "}
            <select
              aria-label="Pencere"
              value={preset}
              onChange={(e) => setPreset(e.target.value)}
            >
              {Object.keys(modes).map((k) => (
                <option key={k}>{k}</option>
              ))}
            </select>
          </label>
          <label>
            Yazı{" "}
            <select
              aria-label="Yazı ölçeği"
              value={font}
              onChange={(e) => setFont(Number(e.target.value))}
            >
              {[0.85, 1, 1.3, 1.6, 2].map((n) => (
                <option key={n} value={n}>
                  {n}×
                </option>
              ))}
            </select>
          </label>
          <label>
            <input
              aria-label="Güvenli alan"
              type="checkbox"
              checked={safe}
              onChange={(e) => setSafe(e.target.checked)}
            />
            Güvenli alan
          </label>
        </nav>
      </header>
      <main>
        <div id="device" style={{ width: p.width, height: p.height }}>
          <EliteShowcase
            key={preset}
            {...p}
            fontScale={font}
            safeArea={safe ? { left: 48, right: 32, top: 24, bottom: 40 } : {}}
          />
        </div>
      </main>
      <footer>
        Tab / yön tuşları: odak · Enter: seçim · Escape: paneli kapat · Native
        TV kabulü için Homatics testi gerekir.
      </footer>
    </>
  );
}
// Web-only fixture navigation: no Android interceptor or production remote handler is added.
document.addEventListener("keydown", (event) => {
  const current = document.activeElement as HTMLElement;
  if (!current?.dataset.testid?.startsWith("elite-target:")) return;
  if (event.key === "Escape") {
    document
      .querySelector<HTMLElement>('[data-testid="elite-target:overlay:close"]')
      ?.click();
    return;
  }
  const dir = (
    {
      ArrowLeft: "left",
      ArrowRight: "right",
      ArrowUp: "up",
      ArrowDown: "down",
    } as const
  )[event.key as "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown"];
  if (!dir) return;
  const entries = Array.from(
    document.querySelectorAll<HTMLElement>('[data-testid^="elite-target:"]'),
  )
    .filter((e) => e.getAttribute("aria-disabled") !== "true")
    .map((e) => ({
      id: e.dataset.testid!,
      bounds: {
        x: e.getBoundingClientRect().x,
        y: e.getBoundingClientRect().y,
        width: e.clientWidth,
        height: e.clientHeight,
      },
      press() {
        e.click();
      },
      setFocused() {},
      node: e,
    }));
  const from = entries.find((e) => e.node === current);
  if (!from) return;
  const panelOrder = entries.filter(
    (entry) =>
      entry.id === "elite-target:overlay:close" ||
      entry.id.startsWith("elite-target:panel:"),
  );
  const index = panelOrder.findIndex((entry) => entry.id === from.id);
  const next =
    index >= 0 && (dir === "up" || dir === "down")
      ? (panelOrder[index + (dir === "down" ? 1 : -1)] ?? null)
      : resolveTVPreviewFocusTarget(from, dir, entries);
  if (next) {
    event.preventDefault();
    const node = entries.find((e) => e.id === next.id)!.node;
    node.focus();
    node.scrollIntoView({ block: "nearest", inline: "nearest" });
  }
});
createRoot(document.getElementById("root")!).render(<Preview />);
