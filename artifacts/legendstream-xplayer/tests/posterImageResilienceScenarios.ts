import { normalizeImageUrl } from "../lib/imageUrl";
import { projectCatalogItem } from "../lib/catalogPersistence";

let passed = 0;
const total = 6;

function expect(name: string, condition: boolean) {
  if (!condition) throw new Error(`FAILED: ${name}`);
  passed += 1;
}

expect(
  "protocol-relative artwork is normalized to https",
  normalizeImageUrl("//cdn.example.com/p.jpg") === "https://cdn.example.com/p.jpg",
);
expect(
  "whitespace-only artwork becomes null",
  normalizeImageUrl("   ") === null,
);
expect(
  "empty artwork becomes null",
  normalizeImageUrl("") === null,
);
expect(
  "valid https artwork is preserved",
  normalizeImageUrl("https://cdn.example.com/p.jpg") === "https://cdn.example.com/p.jpg",
);
expect(
  "whitespace-only catalog name is rejected before cache persistence",
  projectCatalogItem("provider-1", "vod", {
    stream_id: 1,
    name: "   ",
    stream_icon: "https://cdn.example.com/p.jpg",
    container_extension: "mp4",
  }) === null,
);
const valid = projectCatalogItem("provider-1", "vod", {
  stream_id: 2,
  name: "  Valid movie  ",
  stream_icon: "https://cdn.example.com/p.jpg",
  container_extension: "mp4",
});
expect(
  "valid catalog name is persisted after trimming",
  valid?.catalogKind === "vod" && valid.name === "Valid movie",
);

console.log(`poster image resilience scenarios: ${passed}/${total} passed`);
