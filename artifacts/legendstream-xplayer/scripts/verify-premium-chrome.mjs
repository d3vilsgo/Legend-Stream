import fs from "node:fs";

const source = fs.readFileSync(new URL("../components/player/PlayerChrome.tsx", import.meta.url), "utf8");

const required = [
  "useFade",
  "topGradient",
  "bottomGradient",
  "Şimdi:",
  "Sıradaki:",
  "formatRemaining",
  "chrome.controlsVisible",
  "chrome.infoVisible",
];

for (const token of required) {
  if (!source.includes(token)) throw new Error(`Missing premium chrome token: ${token}`);
}

if (source.includes("Program bilgisi yok")) {
  throw new Error("Empty EPG placeholder must not be rendered in premium chrome.");
}

if (source.includes('backgroundColor: "#07101a"')) {
  throw new Error("Legacy opaque InfoCard background is still present.");
}

console.log("Premium player chrome source assertions passed.");
