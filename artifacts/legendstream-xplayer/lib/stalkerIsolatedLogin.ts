import { safeLog, sanitizeErrorForLog } from "./safeLog";
import { bootstrapStalkerProfile } from "./stalkerProfileBootstrap";
import {
  createStalkerPortalSession,
  StalkerPortalError,
  type StalkerPortalDiagnosticsContext,
  type StalkerPortalSession,
} from "./stalkerPortal";

export type StalkerMainInfoClassification =
  | "GET_MAIN_INFO_OPTIONAL_SUPPORTED"
  | "GET_MAIN_INFO_UNSUPPORTED";

export type StalkerIsolatedLoginStatus =
  | "IDLE"
  | "CONNECTING"
  | "CONNECTED"
  | "ERROR";

export type StalkerIsolatedGenreStatus =
  | "IDLE"
  | "GENRES_LOADING"
  | "ITV_CATEGORIES_READY"
  | "GENRES_ERROR";

export type StalkerIsolatedChannelStatus =
  | "CHANNELS_IDLE"
  | "CHANNELS_LOADING"
  | "ITV_CHANNELS_READY"
  | "CHANNELS_ERROR";

export type StalkerIsolatedPlaybackStatus =
  | "PLAYBACK_IDLE"
  | "PLAYBACK_LOADING"
  | "PLAYBACK_READY"
  | "PLAYBACK_ERROR";

export type StalkerIsolatedAccountInfo = {
  profileSupported: boolean;
  profileName?: string;
  accountStatus?: string;
  expiry?: string;
  mainInfoClassification: StalkerMainInfoClassification;
};

export type StalkerIsolatedCategory = {
  id: string;
  title: string;
  order?: number;
};

export type StalkerIsolatedChannel = {
  id: string;
  title: string;
  cmd: string;
  logoUrl?: string;
  number?: number;
};

export type StalkerIsolatedLoginResult = {
  state: "CONNECTED";
  accountInfo: StalkerIsolatedAccountInfo;
  networkActions: string[];
  session: StalkerIsolatedSession;
};

export type StalkerIsolatedSession = Pick<StalkerPortalSession, "handshake" | "request">;

type StalkerIsolatedLoginDependencies = {
  createSession?: (input: {
    portalUrl: string;
    mac: string;
    diagnostics: StalkerPortalDiagnosticsContext;
  }) => StalkerIsolatedSession;
};

const UNSUPPORTED_TEXT = /\b(?:unknown|unsupported|not\s+implemented|not\s+available)\b/i;

function stringField(row: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return undefined;
}

function objectPayload(payload: unknown): Record<string, unknown> | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  return payload as Record<string, unknown>;
}

function payloadLooksUnsupported(payload: unknown) {
  if (typeof payload === "string") return UNSUPPORTED_TEXT.test(payload);
  const row = objectPayload(payload);
  if (!row) return payload == null;
  return [row.error, row.message, row.reason, row.status].some((value) =>
    typeof value === "string" && UNSUPPORTED_TEXT.test(value),
  );
}

function metadataFromPayload(profilePayload: unknown, mainInfoPayload?: unknown): Omit<
  StalkerIsolatedAccountInfo,
  "profileSupported" | "mainInfoClassification"
> {
  const mainInfo = objectPayload(mainInfoPayload);
  const profile = objectPayload(profilePayload);
  const source = mainInfo ?? profile ?? {};
  return {
    profileName: stringField(source, ["name", "fname", "login", "account", "tariff_plan"]),
    accountStatus: stringField(source, ["status", "account_status", "state"]),
    expiry: stringField(source, ["end_date", "expire_billing_date", "expires", "expiry", "exp_date"]),
  };
}

async function readOptionalMainInfo(
  session: StalkerIsolatedSession,
  signal: AbortSignal | undefined,
  diagnostics: StalkerPortalDiagnosticsContext,
) {
  try {
    const payload = await session.request(
      { type: "account_info", action: "get_main_info" },
      signal,
      undefined,
      diagnostics,
    );
    if (payloadLooksUnsupported(payload)) {
      return {
        classification: "GET_MAIN_INFO_UNSUPPORTED" as const,
        payload: undefined,
      };
    }
    return {
      classification: "GET_MAIN_INFO_OPTIONAL_SUPPORTED" as const,
      payload,
    };
  } catch (caught) {
    safeLog.info("LS_STALKER_ISOLATED_MAIN_INFO_UNAVAILABLE", {
      error: sanitizeErrorForLog(caught),
    });
    return {
      classification: "GET_MAIN_INFO_UNSUPPORTED" as const,
      payload: undefined,
    };
  }
}

function arrayPayload(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  const row = objectPayload(payload);
  const js = row?.js;
  if (Array.isArray(js)) return js;
  const data = row?.data;
  if (Array.isArray(data)) return data;
  return [];
}

function categoryId(row: Record<string, unknown>, fallbackIndex: number) {
  return stringField(row, ["id", "genre_id", "category_id", "alias"]) ?? `stalker-category-${fallbackIndex}`;
}

function categoryTitle(row: Record<string, unknown>) {
  return stringField(row, ["title", "name", "genre_name", "category_name"]);
}

function categoryOrder(row: Record<string, unknown>, fallbackIndex: number) {
  const raw = row.number ?? row.order ?? row.position ?? row.index ?? fallbackIndex;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string" && raw.trim() && Number.isFinite(Number(raw))) return Number(raw);
  return fallbackIndex;
}

export function normalizeIsolatedStalkerCategories(payload: unknown): StalkerIsolatedCategory[] {
  const seen = new Set<string>();
  const categories: StalkerIsolatedCategory[] = [];
  arrayPayload(payload).forEach((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return;
    const row = item as Record<string, unknown>;
    const title = categoryTitle(row);
    if (!title) return;
    const id = categoryId(row, index);
    if (seen.has(id)) return;
    seen.add(id);
    categories.push({ id, title, order: categoryOrder(row, index) });
  });
  return categories.sort((left, right) => {
    const orderDelta = (left.order ?? 0) - (right.order ?? 0);
    return orderDelta || left.title.localeCompare(right.title);
  });
}

function channelId(row: Record<string, unknown>) {
  return stringField(row, ["id", "ch_id", "stream_id", "channel_id"]);
}

function channelTitle(row: Record<string, unknown>) {
  return stringField(row, ["name", "title"]);
}

function channelCommand(row: Record<string, unknown>) {
  return stringField(row, ["cmd", "url"]);
}

function channelNumber(row: Record<string, unknown>) {
  const raw = row.number ?? row.channel_number ?? row.num;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string" && raw.trim() && Number.isFinite(Number(raw))) return Number(raw);
  return undefined;
}

export function normalizeIsolatedStalkerChannels(payload: unknown): StalkerIsolatedChannel[] {
  const seen = new Set<string>();
  const channels: StalkerIsolatedChannel[] = [];
  arrayPayload(payload).forEach((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return;
    const row = item as Record<string, unknown>;
    const id = channelId(row);
    if (!id || seen.has(id)) return;
    const title = channelTitle(row);
    const cmd = channelCommand(row);
    if (!title || !cmd) return;
    seen.add(id);
    channels.push({
      id,
      title,
      cmd,
      logoUrl: stringField(row, ["logo", "logo_url", "stream_icon"]),
      number: channelNumber(row),
    });
  });
  return channels.sort((left, right) => {
    const numberDelta = (left.number ?? Number.MAX_SAFE_INTEGER) - (right.number ?? Number.MAX_SAFE_INTEGER);
    return numberDelta || left.title.localeCompare(right.title);
  });
}

export async function loadIsolatedStalkerGenres(
  session: StalkerIsolatedSession,
  input: { signal?: AbortSignal; diagnostics?: StalkerPortalDiagnosticsContext } = {},
): Promise<StalkerIsolatedCategory[]> {
  const diagnostics = input.diagnostics ?? { providerId: "isolated-stalker-genres" };
  const payload = await session.request(
    { type: "itv", action: "get_genres" },
    input.signal,
    undefined,
    diagnostics,
  );
  return normalizeIsolatedStalkerCategories(payload);
}

export async function loadIsolatedStalkerCategoryChannels(
  session: StalkerIsolatedSession,
  category: StalkerIsolatedCategory,
  input: { signal?: AbortSignal; diagnostics?: StalkerPortalDiagnosticsContext; page?: number } = {},
): Promise<StalkerIsolatedChannel[]> {
  const genre = category.id.trim();
  if (!genre || genre === "*") {
    throw new StalkerPortalError("INVALID_RESPONSE", "This Stalker category cannot be fetched with get_ordered_list.");
  }
  const diagnostics = input.diagnostics ?? { providerId: "isolated-stalker-channels" };
  const page = input.page ?? 1;
  const payload = await session.request(
    { type: "itv", action: "get_ordered_list", genre, p: page },
    input.signal,
    undefined,
    diagnostics,
  );
  return normalizeIsolatedStalkerChannels(payload);
}

function playableUrl(payload: unknown) {
  if (typeof payload === "string") return payload.replace(/^ffmpeg\s+/i, "").trim();
  const row = objectPayload(payload);
  return row ? (stringField(row, ["cmd", "url", "link"]) ?? "").replace(/^ffmpeg\s+/i, "").trim() : "";
}

export async function resolveIsolatedStalkerChannelLink(
  session: StalkerIsolatedSession,
  channel: StalkerIsolatedChannel,
  input: { signal?: AbortSignal; diagnostics?: StalkerPortalDiagnosticsContext } = {},
): Promise<string> {
  const cmd = channel.cmd.trim();
  if (!cmd) throw new StalkerPortalError("INVALID_RESPONSE", "Stalker channel has no playback command.");
  const diagnostics = input.diagnostics ?? { providerId: "isolated-stalker-playback" };
  const source = playableUrl(await session.request(
    { type: "itv", action: "create_link", cmd },
    input.signal,
    undefined,
    diagnostics,
  ));
  if (!source) throw new StalkerPortalError("INVALID_RESPONSE", "Stalker portal did not return a playable link.");
  try {
    const url = new URL(source);
    if (!["http:", "https:", "rtsp:", "rtmp:"].includes(url.protocol)) throw new Error("protocol");
  } catch {
    throw new StalkerPortalError("INVALID_RESPONSE", "Stalker portal did not return a playable link.");
  }
  return source;
}

export async function runIsolatedStalkerLogin(
  input: { portalUrl: string; mac: string; signal?: AbortSignal },
  dependencies: StalkerIsolatedLoginDependencies = {},
): Promise<StalkerIsolatedLoginResult> {
  const portalUrl = input.portalUrl.trim();
  const mac = input.mac.trim();
  if (!portalUrl || !mac) {
    throw new StalkerPortalError("MISSING_MAC", "Stalker portal URL and MAC address are required.");
  }

  const networkActions: string[] = [];
  const diagnostics = { providerId: "isolated-stalker-login" };
  const session = dependencies.createSession?.({ portalUrl, mac, diagnostics }) ?? createStalkerPortalSession({
    portalUrl,
    mac,
    diagnostics,
  });

  networkActions.push("handshake");
  await session.handshake(input.signal);

  networkActions.push("get_profile");
  const profile = await bootstrapStalkerProfile(session as StalkerPortalSession, {
    signal: input.signal,
    diagnostics,
  });
  if (!profile.supported) {
    throw new StalkerPortalError("INVALID_RESPONSE", "Stalker profile request is not supported.");
  }

  networkActions.push("get_main_info");
  const mainInfo = await readOptionalMainInfo(session, input.signal, diagnostics);
  const accountInfo = metadataFromPayload(profile.payload, mainInfo.payload);

  return {
    state: "CONNECTED",
    accountInfo: {
      profileSupported: true,
      mainInfoClassification: mainInfo.classification,
      ...accountInfo,
    },
    networkActions,
    session,
  };
}
