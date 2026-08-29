export type ProviderDisplayInput = {
  type: string;
  url?: string;
  playlistUrl?: string;
  username?: string;
  mac?: string;
};

export type ProviderListPresentation = {
  host: string;
  maskedIdentifier: string | null;
  meta: string;
};

const urlForParsing = (value: string) =>
  /^[a-z][a-z\d+\-.]*:\/\//i.test(value) ? value : `http://${value}`;

function parseProviderUrl(value?: string) {
  const clean = value?.trim();
  if (!clean) return null;
  try {
    return new URL(urlForParsing(clean));
  } catch {
    return null;
  }
}

export function providerDisplayHost(value?: string) {
  const parsed = parseProviderUrl(value);
  return parsed?.hostname.toLowerCase() || "—";
}

export function maskProviderIdentifier(value?: string) {
  const clean = value?.trim();
  if (!clean) return null;
  if (clean.length <= 3) return "*".repeat(clean.length);
  return `${clean.slice(0, 2)}${"*".repeat(clean.length - 3)}${clean.slice(-1)}`;
}

export function providerListPresentation(provider: ProviderDisplayInput): ProviderListPresentation {
  const source = provider.url || provider.playlistUrl;
  const parsed = parseProviderUrl(source);
  const queryUsername = parsed?.searchParams.get("username")?.trim() || undefined;
  const maskedIdentifier = maskProviderIdentifier(
    provider.username || queryUsername || provider.mac,
  );
  const typeLabel = provider.type.trim().toUpperCase() || "SOURCE";

  return {
    host: parsed?.hostname.toLowerCase() || "—",
    maskedIdentifier,
    meta: maskedIdentifier ? `${typeLabel} · ${maskedIdentifier}` : typeLabel,
  };
}
