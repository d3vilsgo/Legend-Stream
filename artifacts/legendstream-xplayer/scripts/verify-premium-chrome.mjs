import fs from "node:fs";

const source = fs.readFileSync(new URL("../components/player/PlayerChrome.tsx", import.meta.url), "utf8");

const required = [
  "LinearGradient",
  "Şimdi:",
  "Sıradaki:",
  "useFade",
];

for (const token of required) {
  if (!source.includes(token)) {
    throw new Error(`Premium player chrome regression: missing ${token}`);
  }
}

if (source.includes("Program bilgisi yok")) {
  throw new Error("Premium player chrome regression: empty EPG placeholder returned");
}

console.log("Premium player chrome source verification passed.");
