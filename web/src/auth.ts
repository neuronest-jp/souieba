// トークンの保持（ADR-0007）。@capacitor/preferences はネイティブでは端末の設定領域、Web では localStorage を使う。
import { Preferences } from "@capacitor/preferences";

const KEY = "souieba.token";
const USER_KEY = "souieba.user";

let cached: string | null | undefined;

export async function loadToken(): Promise<string | null> {
  if (cached !== undefined) return cached;
  try {
    const { value } = await Preferences.get({ key: KEY });
    cached = value;
  } catch {
    cached = null;
  }
  return cached;
}

export const getTokenSync = (): string | null => cached ?? null;

export async function saveToken(token: string, userId: string): Promise<void> {
  cached = token;
  try {
    await Preferences.set({ key: KEY, value: token });
    await Preferences.set({ key: USER_KEY, value: userId });
  } catch {
    /* 保存できなくてもこのセッションは続けられる */
  }
}

export async function clearToken(): Promise<void> {
  cached = null;
  try {
    await Preferences.remove({ key: KEY });
    await Preferences.remove({ key: USER_KEY });
  } catch {
    /* 無視 */
  }
}
