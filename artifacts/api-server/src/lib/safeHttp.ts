import { lookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";

export class SafeHttpError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "SSRF_BLOCKED"
      | "DNS_FAILED"
      | "TIMEOUT"
      | "UNREACHABLE"
      | "TOO_MANY_REDIRECTS"
      | "RESPONSE_TOO_LARGE",
  ) {
    super(message);
    this.name = "SafeHttpError";
  }
}

type PinnedAddress = { address: string; family: 4 | 6 };
type SafeResponse = { status: number; text: string };

const MAX_REDIRECTS = 4;
const MAX_RESPONSE_BYTES = 64 * 1024 * 1024;

function ipv4Number(address: string): number | null {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null;
  return (((parts[0] * 256 + parts[1]) * 256 + parts[2]) * 256 + parts[3]) >>> 0;
}

function inV4Cidr(address: string, network: string, prefix: number): boolean {
  const ip = ipv4Number(address);
  const base = ipv4Number(network);
  if (ip === null || base === null) return false;
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (ip & mask) === (base & mask);
}

const blockedV4: Array<[string, number]> = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];

function normalizeIpv6(address: string): string {
  return address.toLowerCase().split("%")[0];
}

function blockedIpv6(address: string): boolean {
  const value = normalizeIpv6(address);
  if (value === "::" || value === "::1") return true;
  const mapped = value.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isBlockedAddress(mapped[1]);
  const first = value.split(":")[0] || "0";
  const firstValue = Number.parseInt(first, 16);
  if (!Number.isFinite(firstValue)) return true;
  if ((firstValue & 0xfe00) === 0xfc00) return true;
  if ((firstValue & 0xffc0) === 0xfe80) return true;
  if ((firstValue & 0xff00) === 0xff00) return true;
  if (value.startsWith("2001:db8:")) return true;
  if (value.startsWith("100::") || value.startsWith("100:0:0:1")) return true;
  return false;
}

export function isBlockedAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return blockedV4.some(([network, prefix]) => inV4Cidr(address, network, prefix));
  if (family === 6) return blockedIpv6(address);
  return true;
}

export async function resolvePublicHost(hostname: string): Promise<PinnedAddress> {
  const normalized = hostname.trim().toLowerCase().replace(/\.$/, "");
  if (!normalized || normalized === "localhost" || normalized.endsWith(".localhost")) {
    throw new SafeHttpError("Local/private provider addresses are not allowed.", "SSRF_BLOCKED");
  }

  const literalFamily = isIP(normalized);
  if (literalFamily) {
    if (isBlockedAddress(normalized)) {
      throw new SafeHttpError("Local/private provider addresses are not allowed.", "SSRF_BLOCKED");
    }
    return { address: normalized, family: literalFamily as 4 | 6 };
  }

  let addresses: Array<{ address: string; family: number }>;
  try {
    addresses = await lookup(normalized, { all: true, verbatim: true });
  } catch {
    throw new SafeHttpError("The provider hostname could not be resolved.", "DNS_FAILED");
  }
  if (!addresses.length) throw new SafeHttpError("The provider hostname could not be resolved.", "DNS_FAILED");
  if (addresses.some((entry) => isBlockedAddress(entry.address))) {
    throw new SafeHttpError("The provider hostname resolves to a local/private address.", "SSRF_BLOCKED");
  }
  const selected = addresses.find((entry) => entry.family === 4 || entry.family === 6);
  if (!selected) throw new SafeHttpError("The provider hostname could not be resolved.", "DNS_FAILED");
  return { address: selected.address, family: selected.family as 4 | 6 };
}

function requestPinned(
  url: URL,
  pinned: PinnedAddress,
  headers: Record<string, string>,
  timeoutMs: number,
): Promise<SafeResponse & { location?: string }> {
  return new Promise((resolve, reject) => {
    const request = url.protocol === "https:" ? httpsRequest : httpRequest;
    const req = request(
      url,
      {
        method: "GET",
        headers,
        lookup: (_hostname, _options, callback) => {
          callback(null, pinned.address, pinned.family);
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        let total = 0;
        res.on("data", (chunk: Buffer | string) => {
          const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          total += data.length;
          if (total > MAX_RESPONSE_BYTES) {
            req.destroy(new SafeHttpError("The provider response is too large.", "RESPONSE_TOO_LARGE"));
            return;
          }
          chunks.push(data);
        });
        res.on("end", () => {
          resolve({
            status: res.statusCode ?? 502,
            text: Buffer.concat(chunks).toString("utf8"),
            location: typeof res.headers.location === "string" ? res.headers.location : undefined,
          });
        });
      },
    );
    req.setTimeout(timeoutMs, () => {
      req.destroy(new SafeHttpError("The provider request timed out.", "TIMEOUT"));
    });
    req.on("error", (error) => {
      if (error instanceof SafeHttpError) reject(error);
      else reject(new SafeHttpError("The provider could not be reached.", "UNREACHABLE"));
    });
    req.end();
  });
}

export async function safeGetText(
  input: URL,
  headers: Record<string, string>,
  timeoutMs = 20_000,
  redirectsLeft = MAX_REDIRECTS,
): Promise<SafeResponse> {
  if (!["http:", "https:"].includes(input.protocol)) {
    throw new SafeHttpError("Only HTTP/HTTPS provider URLs are allowed.", "SSRF_BLOCKED");
  }
  const pinned = await resolvePublicHost(input.hostname);
  const response = await requestPinned(input, pinned, headers, timeoutMs);
  if ([301, 302, 303, 307, 308].includes(response.status) && response.location) {
    if (redirectsLeft <= 0) {
      throw new SafeHttpError("The provider redirected too many times.", "TOO_MANY_REDIRECTS");
    }
    const redirected = new URL(response.location, input);
    return safeGetText(redirected, headers, timeoutMs, redirectsLeft - 1);
  }
  return { status: response.status, text: response.text };
}
