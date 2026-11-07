// 季節と時間帯（ブラッシュアップ 11/7、ADR-0011）。画面が毎日同じに見えないよう、押し葉や問いかけの言葉をこれで選ぶ。
// どちらも Asia/Tokyo の暦と時刻で決める（端末の時刻設定が UTC などでも、日本の季節・時間帯になる。date.ts の todayInTokyo と同じ基準）。
// 色や絵の中身は season の受け持ち（components/motifs、styles/season.css）、言葉は today の受け持ち（TodayScreen まわり）が決める。

export type Season = "spring" | "summer" | "autumn" | "winter";
export type TimeOfDay = "morning" | "day" | "evening" | "night";

const TOKYO_MD_H = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Tokyo",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  hourCycle: "h23",
});

const tokyoParts = (now: Date): { month: number; day: number; hour: number } => {
  const parts = TOKYO_MD_H.formatToParts(now);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? "0");
  return { month: get("month"), day: get("day"), hour: get("hour") };
};

/** 季節: 春 3〜5 月、夏 6〜8 月、秋 9〜11 月、冬 12〜2 月（暮らしの季節感に合わせて月で分ける） */
export const seasonOf = (now: Date = new Date()): Season => {
  const { month } = tokyoParts(now);
  if (month >= 3 && month <= 5) return "spring";
  if (month >= 6 && month <= 8) return "summer";
  if (month >= 9 && month <= 11) return "autumn";
  return "winter";
};

/** 時間帯: 朝 5〜10 時、昼 11〜16 時、夕 17〜20 時、夜 21〜4 時 */
export const timeOfDayOf = (now: Date = new Date()): TimeOfDay => {
  const { hour } = tokyoParts(now);
  if (hour >= 5 && hour <= 10) return "morning";
  if (hour >= 11 && hour <= 16) return "day";
  if (hour >= 17 && hour <= 20) return "evening";
  return "night";
};

/** その日のうちは変わらず、日ごとに変わる数（問いかけや押し葉の形を日替わりにするため）。乱数は使わない */
export const daySeed = (now: Date = new Date()): number => {
  const { month, day } = tokyoParts(now);
  const y = Number(
    new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Tokyo", year: "numeric" }).format(now),
  );
  return (y * 372 + month * 31 + day) >>> 0;
};

/**
 * 時間帯を <html data-time="morning|day|evening|night"> に映す。夕方と夜は styles/season.css が地の紙を灯りの色に少し寄せる
 * （文字のコントラスト比は変えない）。main.ts で mount より前に一度呼ぶ（最初の描画から時間帯の地になる）。
 * 開いたまま時間帯をまたいでも替わるよう 1 分ごとに見直し、アプリが前に戻ったとき（visibilitychange。iOS は裏にいる間タイマーを止める）にも見直す。
 * 返す関数で止める。document の無い所（node のテスト）では何もしない
 */
export const applyTimeOfDay = (clock: () => Date = () => new Date()): (() => void) => {
  if (typeof document === "undefined") return () => {};
  const root = document.documentElement;
  const apply = () => {
    const time = timeOfDayOf(clock());
    if (root.dataset.time !== time) root.dataset.time = time;
  };
  const onVisibility = () => {
    if (document.visibilityState === "visible") apply();
  };
  apply();
  const timer = setInterval(apply, 60_000);
  document.addEventListener("visibilitychange", onVisibility);
  return () => {
    clearInterval(timer);
    document.removeEventListener("visibilitychange", onVisibility);
  };
};
