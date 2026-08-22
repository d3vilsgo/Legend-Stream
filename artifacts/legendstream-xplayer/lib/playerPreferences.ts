import AsyncStorage from "@react-native-async-storage/async-storage";

export type PlayerChromeTimeoutSeconds = 3 | 5 | 10;

export const DEFAULT_PLAYER_CHROME_TIMEOUT_SECONDS: PlayerChromeTimeoutSeconds = 3;
export const PLAYER_CHROME_TIMEOUT_OPTIONS: PlayerChromeTimeoutSeconds[] = [3, 5, 10];

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

export async function setPlayerChromeTimeoutSeconds(value: PlayerChromeTimeoutSeconds) {
  await AsyncStorage.setItem(PLAYER_CHROME_TIMEOUT_KEY, String(value));
}
