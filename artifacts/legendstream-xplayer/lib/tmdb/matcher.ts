import {
  type EnrichmentInput,
  type MatchResult,
  type TmdbCandidate,
} from "./contract";

const technical =
  /^(?:2160p|1080[pi]|720p|480p|4k|8k|uhd|fhd|hd|sd|hdr10\+?|hdr|dolby\s*vision|dv|hevc|av1|[xh][ .]?26[45]|aac|ac3|eac3|ddp(?:5[ .]1)?|atmos|web[ .-]?dl|webrip|bluray|blu[ -]?ray|brrip|hdrip|hdtv|dual|multi|tr|en|tr[ -]en|türkçe|turkce|dublaj|altyazılı|altyazili|extended|uncut|remastered|director['’]?s\s+cut)$/iu;
function technicalBlock(value: string): boolean {
  if (technical.test(value)) return true;
  const words = value.split(/\s+/u);
  while (words.length) {
    let found = false;
    for (let n = Math.min(3, words.length); n > 0; n--) {
      if (technical.test(words.slice(0, n).join(" "))) {
        words.splice(0, n);
        found = true;
        break;
      }
    }
    if (!found) return false;
  }
  return true;
}
/** Only bracketed years are inferred. Numeric titles/sequels (1917, 1984, 2049) survive. */
export function inferredYear(title: string): number | undefined {
  const years = [...title.matchAll(/[([]((?:18|19|20)\d{2})[)\]]/gu)].map((m) =>
    Number(m[1]),
  );
  return new Set(years).size === 1 ? years[0] : undefined;
}
export function normalizeTmdbTitle(title: string): string {
  let value = title
    .normalize("NFKC")
    .trim()
    .replace(/\.(?:mkv|mp4|avi|m3u8|ts)$/iu, "");
  value = value.replace(/[([]([^()[\]]+)[)\]]/gu, (whole, group: string) => {
    const parts = group.split(/[|,]/u).map((x) => x.trim());
    return (/^(?:18|19|20)\d{2}$/u.test(group) &&
      value.replace(whole, "").trim() !== "") ||
      parts.every((x) => x.length > 0 && technicalBlock(x))
      ? " "
      : whole;
  });
  // Technical tokens are removed from the suffix only; a title consisting of a tag is retained.
  let previous: string;
  do {
    previous = value;
    const suffix = value.match(/(?:\s+|\s*[|\-]\s*)([^|]+)$/u);
    if (suffix) {
      const words = suffix[1]!.trim().split(/\s+/u);
      for (let n = Math.min(3, words.length); n > 0; n--) {
        const token = words.slice(-n).join(" ");
        if (technical.test(token)) {
          const end = value.lastIndexOf(token);
          const next = value.slice(0, end).replace(/[\s|\-]+$/u, "");
          if (next) value = next;
          break;
        }
      }
    }
  } while (value !== previous);
  return value
    .toLocaleLowerCase("tr-TR")
    .replace(/ı/gu, "i")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/gu, " ");
}
const positiveId = (id: unknown): id is number =>
  typeof id === "number" && Number.isSafeInteger(id) && id > 0;
const validYear = (year: unknown): year is number =>
  typeof year === "number" &&
  Number.isInteger(year) &&
  year >= 1888 &&
  year <= 2100;
/** Conservative policy: exact normalized local/original title AND known identical year.
 * No fuzzy auto-accept. A verified provider ID may tolerate a missing year, never a conflicting one. */
export function matchTmdb(
  input: EnrichmentInput,
  candidates: readonly TmdbCandidate[],
): MatchResult {
  if (candidates.length > 100)
    return { status: "rejected", reason: "ambiguous" };
  const id = input.identity;
  if (
    !id.providerId.trim() ||
    !id.catalogId.trim() ||
    !input.catalogRevision.trim() ||
    !input.title.trim() ||
    !normalizeTmdbTitle(input.title) ||
    input.title.length > 512 ||
    (input.originalTitle?.length ?? 0) > 512 ||
    /:\/\/|(?:password|token|api_key)=/iu.test(
      input.title + (input.originalTitle ?? ""),
    ) ||
    !["movie", "series"].includes(id.kind) ||
    !["xtream", "m3u", "stalker"].includes(id.provider) ||
    (input.year !== undefined && !validYear(input.year)) ||
    (input.providerTmdbId !== undefined && !positiveId(input.providerTmdbId))
  )
    return { status: "rejected", reason: "invalid-input" };
  const titleYears = new Set(
    [...input.title.matchAll(/[([]((?:18|19|20)\d{2})[)\]]/gu)].map(
      (m) => m[1],
    ),
  );
  if (titleYears.size > 1)
    return { status: "rejected", reason: "year-conflict" };
  const inferred = inferredYear(input.title);
  if (input.year && inferred && input.year !== inferred)
    return { status: "rejected", reason: "year-conflict" };
  const year = input.year ?? inferred;
  const names = [input.title, input.originalTitle]
    .filter((x): x is string => !!x)
    .map(normalizeTmdbTitle)
    .filter(Boolean);
  const eligible = candidates.filter(
    (c) =>
      c.kind === id.kind &&
      positiveId(c.id) &&
      (c.year === undefined || validYear(c.year)) &&
      c.title.length <= 512 &&
      (!c.originalTitle || c.originalTitle.length <= 512),
  );
  const titleMatches = (c: TmdbCandidate) =>
    [c.title, c.originalTitle].some(
      (name) => !!name && names.includes(normalizeTmdbTitle(name)),
    );
  if (input.providerTmdbId !== undefined) {
    const verified = eligible.filter(
      (c) => c.id === input.providerTmdbId && c.evidence === "detail",
    );
    if (!verified.length)
      return { status: "rejected", reason: "id-unverified" };
    if (
      verified.some(
        (c) => year !== undefined && c.year !== undefined && c.year !== year,
      )
    )
      return { status: "rejected", reason: "year-conflict" };
    if (!verified.every(titleMatches))
      return { status: "rejected", reason: "no-strong-match" };
    return {
      status: "matched",
      tmdb: { kind: id.kind, id: input.providerTmdbId },
      method: "provider-id",
      confidence: 1,
    };
  }
  const matches = eligible.filter(
    (c) =>
      titleMatches(c) &&
      validYear(c.year) &&
      validYear(year) &&
      c.year === year,
  );
  const unique = [...new Set(matches.map((c) => c.id))];
  if (unique.length > 1) return { status: "rejected", reason: "ambiguous" };
  if (unique.length === 1)
    return {
      status: "matched",
      tmdb: { kind: id.kind, id: unique[0]! },
      method: "title-year",
      confidence: 0.98,
    };
  return { status: "rejected", reason: "no-strong-match" };
}
