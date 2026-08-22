import { normalizeXtreamBaseUrl } from "@/lib/iptv";

export type XtreamAccountInfo = {
  status?: string;
  expiresAt?: number;
  createdAt?: number;
  isTrial?: boolean;
  activeConnections?: number;
  maxConnections?: number;
  serverNow?: number;
  checkedAt: number;
};

type XtreamCredentials = {
  baseUrl: string;
  username: string;
  password: string;
};

const asFiniteInt = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : undefined;
};

const unixMillis = (value: unknown) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return parsed < 10_000_000_000 ? parsed * 1000 : parsed;
};

const parseServerTime = (serverInfo: any) => {
  const timestamp = unixMillis(serverInfo?.timestamp_now);
  if (timestamp) return timestamp;

  const text = typeof serverInfo?.time_now === "string" ? serverInfo.time_now.trim() : "";
  if (!text) return undefined;
  const parsed = Date.parse(text.replace(" ", "T"));
  return Number.isFinite(parsed) ? parsed : undefined;
};

const parseTrial = (value: unknown) =>
  value === true || value === 1 || value === "1" || String(value).toLowerCase() === "true";

export async function getXtreamAccountInfo(
  credentials: XtreamCredentials,
): Promise<XtreamAccountInfo> {
  const baseUrl = normalizeXtreamBaseUrl(credentials.baseUrl);
  const apiUrl = new URL("player_api.php", `${baseUrl}/`);
  apiUrl.searchParams.set("username", credentials.username);
  apiUrl.searchParams.set("password", credentials.password);

  let response: Response;
  try {
    response = await fetch(apiUrl.toString(), { signal: AbortSignal.timeout(15_000) });
  } catch {
    throw new Error("Abonelik bilgileri sunucudan alınamadı.");
  }

  if (!response.ok) throw new Error(`Sunucu HTTP ${response.status} döndürdü.`);

  let payload: any;
  try {
    payload = await response.json();
  } catch {
    throw new Error("Sunucunun abonelik yanıtı geçerli değil.");
  }

  const user = payload?.user_info;
  if (!user || user.auth === 0 || user.auth === "0") {
    throw new Error("Xtream hesabı doğrulanamadı.");
  }

  return {
    status: typeof user.status === "string" ? user.status : undefined,
    expiresAt: unixMillis(user.exp_date),
    createdAt: unixMillis(user.created_at),
    isTrial: parseTrial(user.is_trial),
    activeConnections: asFiniteInt(user.active_cons),
    maxConnections: asFiniteInt(user.max_connections),
    serverNow: parseServerTime(payload?.server_info),
    checkedAt: Date.now(),
  };
}

export const accountNow = (info: XtreamAccountInfo) =>
  info.serverNow
    ? info.serverNow + Math.max(0, Date.now() - info.checkedAt)
    : Date.now();

export const accountRemainingMs = (info: XtreamAccountInfo) =>
  info.expiresAt ? info.expiresAt - accountNow(info) : undefined;
