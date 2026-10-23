import AsyncStorage from "@react-native-async-storage/async-storage";

export type PlayerChromeTimeoutSeconds = 3 | 5 | 10;

export const DEFAULT_PLAYER_CHROME_TIMEOUT_SECONDS: PlayerChromeTimeoutSeconds = 3;
export const PLAYER_CHROME_TIMEOUT_OPTIONS: PlayerChromeTimeoutSeconds[] = [
  3, 5, 10,
];

const PLAYER_CHROME_TIMEOUT_KEY = "@legendstream/player-chrome-timeout-v1";

export async function getPlayerChromeTimeoutSeconds(): Promise<PlayerChromeTimeoutSeconds> {
  try {
    const saved = Number(await AsyncStorage.getItem(PLAYER_CHROME_TIMEOUT_KEY));
    if (saved === 3 || saved === 5 || saved === 10) return saved;
  } catch {
    // Preferences are best-effort; keep the safe default.
  }
  return DEFAULT_PLAYER_CHROME_TIMEOUT_SECONDS;
}

export async function setPlayerChromeTimeoutSeconds(
  value: PlayerChromeTimeoutSeconds,
) {
  if (![3, 5, 10].includes(value)) throw new Error("INVALID_PLAYER_TIMEOUT");
  await AsyncStorage.setItem(PLAYER_CHROME_TIMEOUT_KEY, String(value));
  if ((await AsyncStorage.getItem(PLAYER_CHROME_TIMEOUT_KEY)) !== String(value))
    throw new Error("PLAYER_TIMEOUT_WRITE_FAILED");
}

// Existing VLC preference, also read and written by CompatibilityVideoPlayerV2.
export type SavedPlayerCodecMode = "auto" | "hardware" | "software";
const PLAYER_CODEC_MODE_KEY = "@legendstream/codec-mode-v1";
export async function getSavedPlayerCodecMode(): Promise<SavedPlayerCodecMode> {
  try {
    const value = await AsyncStorage.getItem(PLAYER_CODEC_MODE_KEY);
    if (value === "hardware" || value === "software") return value;
  } catch {}
  return "auto";
}
export async function setSavedPlayerCodecMode(value: SavedPlayerCodecMode) {
  if (value !== "auto" && value !== "hardware" && value !== "software")
    throw new Error("INVALID_PLAYER_CODEC");
  await AsyncStorage.setItem(PLAYER_CODEC_MODE_KEY, value);
  if ((await AsyncStorage.getItem(PLAYER_CODEC_MODE_KEY)) !== value)
    throw new Error("PLAYER_CODEC_WRITE_FAILED");
}
