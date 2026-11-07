<script setup lang="ts">
// S1 きょう。入力 → 保存 → 「残しました」。候補と札は 11/6 で足す。
// App.vue の KeepAlive で残すので、ほかの画面へ移っても書きかけ・残しました・候補・札はそのまま（wireframes 0 節）。
// ブラッシュアップ 11/7（ADR-0011）: 「つい記録したくなる」書く画面にする。どれも急かさない・比べない・責めない。
//   - 問いかけ: 日付の見出しの下に時間帯と季節と日替わりのあいさつ、入力欄の placeholder に問い（components/today/prompts.ts）
//   - このごろ: 7 日分の押し葉（DayLeaves）。あの日のひとこと: 去年以前の同じ日付のあたりの記憶を折りたたんだ便箋で 1 つ（ThatDayLetter）。
//     どちらも GET /api/today の 1 往復（失敗したら何も出さない。書く画面を邪魔しない）
//   - 写真: 便箋の下の段にカメラの札、添えた写真は焼き付けのプリント（PhotoPicker の letter）
//   - 残した瞬間: 押すと便箋が沈み（最短 --duration-base）、返事が来たら saved() の触覚と一緒に保存後の便箋に入れ替わる。
//     「残しました」の横に手書きの ✓、続いて「N こめのひとこと」。候補が届くとミシン目の下から控えがすべり出て、候補が少しずつずれて現れる
//   - 札を待つ間: 控えの下でしつけ糸が縫われる動きと「思い出しています」（WaitingThread）。届いたら札に入れ替え、届かずに終わったら静かに消す
//   - 鍵盤: 出ている間は「保存する」を鍵盤のすぐ上に貼り付ける（styles/today.css。下部ナビは platform が隠す）
// 動きは KeepAlive で DOM が戻るとやり直されるので、離れる前に見せたものは戻ってきたとき動かさない（shownIds など）
import { computed, nextTick, onActivated, onDeactivated, onMounted, onUnmounted, ref, watch } from "vue";
import { api, ApiError } from "../api";
import PhotoImg from "../components/PhotoImg.vue";
import type { Fact, Memory, Precision, Recall, TodayResponse } from "../api/types";
import FactChips from "../components/FactChips.vue";
import RecallCard from "../components/RecallCard.vue";
import { triesLeft, usePolling } from "../composables/usePolling";
import DateSheet from "../components/DateSheet.vue";
import PhotoPicker from "../components/PhotoPicker.vue";
import DayLeaves from "../components/today/DayLeaves.vue";
import SavedCheck from "../components/today/SavedCheck.vue";
import ThatDayLetter from "../components/today/ThatDayLetter.vue";
import WaitingThread from "../components/today/WaitingThread.vue";
import { promptFor } from "../components/today/prompts";
import { PHOTO_MAX_BYTES, shrinkPhoto } from "../photo";
import { formatHappenedOn, isRealYmd, todayInTokyo } from "../date";
import { focusHeading, hrefFor } from "../composables/useScreen";
import { useMemoryDeleted } from "../composables/useMemoryDeleted";
import { useMemoryPhoto } from "../composables/useMemoryPhoto";
import { keepDecided } from "../facts";
import { failed as hapticFailed, saved as hapticSaved } from "../haptics";
import { useKeyboard } from "../keyboard";
import { DURATION, prefersMotion } from "../motion";
import { seasonOf } from "../season";

defineOptions({ name: "TodayScreen" }); // KeepAlive の include で使う

const body = ref("");
const precision = ref<Precision>("day");
const date = ref(todayInTokyo()); // 常に YYYY-MM-DD（既定は Asia/Tokyo の今日）。精度に応じて POST 時に切り詰める
// 「いつ？」で日付か精度を変えたら立てる。立っていなければ、戻ってきたとき・アプリが表に戻ったとき・保存するときに既定の日付（今日）を取り直す
const dateTouched = ref(false);
const sheetOpen = ref(false);
const whenButton = ref<HTMLButtonElement | null>(null);
// 書く画面の見出し（起きた日）と、保存後の見出し「残しました」。押したボタンが消えたあと、ここへフォーカスを置く
const dateHeading = ref<HTMLElement | null>(null);
const savedHeading = ref<HTMLElement | null>(null);
const saving = ref(false);
const error = ref("");
const saved = ref<Memory | null>(null);
// KeepAlive で DOM が戻ると .appear の動きがやり直されるので、離れる前に見せたカードと札は戻ってきたとき動かさない。
// 離れている間や戻ったあとに届いた札は、これまでどおり現れる動きで出す
const shownIds = ref(new Set<string>());
// 401 で S0 に戻ると画面ごと捨てる。保存の途中だった場合に、捨てた画面のためのポーリングを始めない
let alive = true;
onUnmounted(() => {
  alive = false;
  document.removeEventListener("visibilitychange", onVisible);
});
const photo = ref<File | null>(null);
const photoNote = ref("");
// 写真を開いている間（PhotoPicker の picking）。届く前に保存すると写真なしで残るので、その間は「保存する」を押させない（見直し n=14）
const photoPicking = ref(false);

// 問いかけと季節を決める時刻。戻ってきたとき・アプリが表に戻ったとき・もうひとつ書くときだけ取り直す（見ている間に言葉を替えない）
const now = ref(new Date());
const prompt = computed(() => promptFor(now.value));
const season = computed(() => seasonOf(now.value));

// GET /api/today（このごろ・あの日のひとこと・総数）。失敗しても何も出さない。古い応答が新しい応答を上書きしないよう番号を付ける
const today = ref<TodayResponse | null>(null);
let todaySeq = 0;
const loadToday = async (): Promise<TodayResponse | null> => {
  const seq = ++todaySeq;
  try {
    const t = await api.today();
    if (seq !== todaySeq || !alive) return null;
    today.value = t;
    return t;
  } catch {
    return null; // 出せないときは何も出さない
  }
};
// 残したひとことが何こめか（「N こめのひとこと」）。残した時点の数で、その便箋の間は替えない
const savedCount = ref<number | null>(null);
// きょう初めて残したとき、書く画面に戻ったら、きょうの押し葉が押される動きを付ける
const pressToday = ref(false);
// 一度見せた「このごろ」と「あの日のひとこと」は、戻ってきたとき現れる動きをやり直さない
const leavesShown = ref(false);
const thatDayShown = ref<string | null>(null);

// 残した瞬間。sealing: 押してから入れ替わるまで便箋を沈めておく
const sealing = ref(false);
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
// 控え（候補）のすべり出しは一度だけ。離れる前に見せていたら、戻ってきたとき動かさない
const slipShown = ref(false);

// 鍵盤（keyboard.ts）。resize が native だと枠が鍵盤のぶん縮むので、縮んだぶんを測って --keyboard-height から引く（styles/today.css）。
// 鍵盤が閉じている間の高さを基準にし、開いている間の高さとの差を「縮み」とする
const keyboard = useKeyboard();
const baseHeight = ref(typeof window !== "undefined" ? (window.innerHeight ?? 0) : 0);
const viewHeight = ref(baseHeight.value);
const onResize = () => {
  viewHeight.value = window.innerHeight;
  if (!keyboard.open.value) baseHeight.value = window.innerHeight;
};
const keyboardShrink = computed(() => (keyboard.open.value ? Math.max(0, baseHeight.value - viewHeight.value) : 0));
onMounted(() => window.addEventListener("resize", onResize));
onUnmounted(() => window.removeEventListener("resize", onResize));

// 保存直後: 候補と札が届くまで静かに待つ（両方の pending が false で止まる）。
// S1 を離れている間は止め（S3 を開いていれば S3 が自分で取り直す）、戻って取り直した記憶がまだ pending なら残りの回数だけ続ける。
// 30 秒の打ち切り（requirements N-2）は、離れて戻ったあとも保存した時刻（savedAt）から数える
const facts = ref<Fact[]>([]);
const recalls = ref<Recall[]>([]);
// 札の pending（最後に読んだ値）。null はまだ読んでいない
const recallPending = ref<boolean | null>(null);
const polling = usePolling(
  async () => {
    const id = saved.value!.id;
    const [f, r] = await Promise.all([api.getFacts(id), api.getRecalls(id)]);
    return { f, r };
  },
  (v) => !v.f.pending && !v.r.pending,
);
const applyPolled = (v: { f: { items: Fact[] }; r: { pending: boolean; items: Recall[] } } | null) => {
  if (!v) return;
  // 画面で確定・却下した行は同じオブジェクトのまま残す（keepDecided）。行ごと新しいオブジェクトに替えると、
  // 記録に失敗したとき FactChips が戻す印が画面の行に届かず、「✓ そう」のまま「記録できませんでした」が並ぶ。
  // facts が先に揃い recall を待つ間（最長 30 秒）も 2 秒ごとに取り直すので、押した直後に取り直しが重なりうる
  facts.value = keepDecided(facts.value, v.f.items);
  recalls.value = v.r.items;
  recallPending.value = v.r.pending;
};
watch(() => polling.value.value, (v) => applyPolled(v));

// 札を待つ間（WaitingThread）。取り直しの最中で、札がまだ 1 枚も無く、札の pending が false と分かっていない間だけ出す。
// 届いたら札に入れ替わり、届かずに終わったら（pending が false か 30 秒の打ち切り）静かに薄れて消える。「見つかりませんでした」とは言わない
const waiting = computed(() => !!saved.value && polling.active.value && recalls.value.length === 0 && recallPending.value !== false);
const waitingLeaving = ref(false);
let leavingTimer: ReturnType<typeof setTimeout> | null = null;
watch(waiting, (on, was) => {
  if (leavingTimer) clearTimeout(leavingTimer);
  leavingTimer = null;
  waitingLeaving.value = false;
  if (was && !on && recalls.value.length === 0 && saved.value) {
    waitingLeaving.value = true;
    leavingTimer = setTimeout(() => (waitingLeaving.value = false), DURATION.base + 40);
  }
});
// 読み上げの知らせ（role="status"）。後から差し込んだ知らせは VoiceOver が読まないことがあるので、入れ物は <main> の中に初めから 1 つ置き、
// 文字だけ入れ替える（ConnectionsScreen と同じ形）。保存の間は「残しています」、札を待つ間は「思い出しています」、ほかは空。
// 見た目が現れるのと同じ間（today.css の .today-saving は 400ms、.waiting-inner は 600ms 待つ）を待ってから入れるので、
// すぐ終わる保存や、すぐ届く札では読まない。「残しました」の見出しへ置くフォーカスの読み上げとも重ならない（動きを減らす設定では見た目も待たないので、待たない）
const LIVE_DELAY_MS = { saving: 400, waiting: 600 } as const;
const liveWant = computed(() => (saving.value ? "saving" : waiting.value ? "waiting" : null));
const LIVE_TEXT = { saving: "残しています", waiting: "思い出しています" } as const;
const liveText = ref("");
let liveTimer: ReturnType<typeof setTimeout> | null = null;
watch(liveWant, (want) => {
  if (liveTimer) clearTimeout(liveTimer);
  liveTimer = null;
  if (!want) {
    liveText.value = "";
    return;
  }
  if (!prefersMotion()) {
    liveText.value = LIVE_TEXT[want];
    return;
  }
  liveText.value = "";
  liveTimer = setTimeout(() => {
    liveTimer = null;
    liveText.value = LIVE_TEXT[want];
  }, LIVE_DELAY_MS[want]);
});
onUnmounted(() => {
  if (liveTimer) clearTimeout(liveTimer);
});

let savedAt = 0;
// S1 が表に出ているか（KeepAlive の onActivated / onDeactivated）。離れている間に保存が終わっても、そこではポーリングを始めない
let shown = true;
const resumePolling = () => {
  if (alive && shown && saved.value) polling.start(triesLeft(savedAt));
};

const MAX = 2000;
const remaining = computed(() => MAX - Array.from(body.value).length);
// 形だけでなく実在する日付か（2026-11-31 のまま送ると Worker が 400 を返し、汎用の文言しか出ないので直せない）
const hasDate = computed(() => precision.value === "unknown" || isRealYmd(date.value));
const canSave = computed(
  () => body.value.trim().length > 0 && remaining.value >= 0 && hasDate.value && !saving.value && !photoPicking.value,
);

// POST に入れる happened_on（day: YYYY-MM-DD / month: YYYY-MM / year: YYYY）
const happenedOnForPost = computed(() => {
  if (precision.value === "month") return date.value.slice(0, 7);
  if (precision.value === "year") return date.value.slice(0, 4);
  return date.value;
});

// 見出しは選んだ精度で丸めた起きた日
const headingDate = computed(() => {
  if (precision.value === "unknown") return formatHappenedOn(null, "unknown");
  if (!hasDate.value) return formatHappenedOn(todayInTokyo(), precision.value);
  return formatHappenedOn(date.value, precision.value);
});

const closeSheet = () => {
  sheetOpen.value = false;
  void nextTick(() => whenButton.value?.focus());
};

const save = async () => {
  if (!canSave.value) return;
  // 夜に開いたまま裏に回し、翌朝そのまま書いたときに前日で残さない（visibilitychange が届かない WebView もある）
  refreshDefaultDate();
  saving.value = true;
  // 便箋を沈める。返事が先に来ても、封をする間（--duration-base）は見せる（動きを減らす設定では待たない）
  sealing.value = true;
  const hold = prefersMotion() ? wait(DURATION.base) : Promise.resolve();
  error.value = "";
  photoNote.value = "";
  // POST の前に読めていた「このごろ」と総数。保存の途中で読み直しが入ると（アプリを裏に回して戻る・離れて戻る）、
  // today はもう新しい記憶を数えているので、そこへ 1 を足すと 1 つ多くなる（見直し 3 回目）。数と押し葉はこの時点のものを基にする
  const before = today.value;
  // きょう初めて残すか（書く画面に戻ったとき、きょうの押し葉を押す動きにする）
  const firstToday = before ? before.week.at(-1)?.wrote === false : false;
  let memory: Memory;
  try {
    memory = await api.createMemory({
      body: body.value.trim(),
      happened_on_precision: precision.value,
      ...(precision.value === "unknown" ? {} : { happened_on: happenedOnForPost.value }),
    });
  } catch {
    error.value = "うまく保存できませんでした。もう少ししてから、もう一度";
    saving.value = false;
    sealing.value = false;
    hapticFailed();
    return;
  }
  // 記憶は残った。写真だけ失敗しても記憶は消さない（requirements F2 エラー時）
  if (photo.value) {
    try {
      const blob = await shrinkPhoto(photo.value);
      if (blob.size > PHOTO_MAX_BYTES) throw new Error("too large");
      const r = await api.putPhoto(memory.id, blob);
      memory = { ...memory, photo_key: r.photo_key, photo_content_type: r.photo_content_type };
    } catch {
      photoNote.value = "写真だけ、あとでもう一度";
    }
  }
  await hold;
  // 総数は、POST の前に読めていればその場で 1 足して出し（✓ と同じ間に）、読み直しで合わせる
  savedCount.value = before ? before.total + 1 : null;
  // 保存の途中で読み直しが入っていれば（today が POST の前のものでない）、その応答をそのまま使う（もう一度 1 を足さない）
  if (before && today.value === before) {
    today.value = { ...before, total: before.total + 1, week: before.week.map((d, i) => (i === before.week.length - 1 ? { ...d, wrote: true } : d)) };
  }
  pressToday.value = firstToday;
  // 書く画面は保存後の画面に替わる。もうひとつ書くで戻ったとき、このごろとあの日のひとことは現れる動きをやり直さない（押し葉だけ押す）
  if (today.value) leavesShown.value = true;
  if (today.value?.that_day) thatDayShown.value = today.value.that_day.memory.id;
  // 書く画面ごと日付のシートも外れる。開いた状態を保存後の画面に持ち越さない（「もうひとつ書く」で勝手に開く）
  sheetOpen.value = false;
  saved.value = memory;
  body.value = "";
  photo.value = null;
  saving.value = false;
  sealing.value = false;
  slipShown.value = false;
  facts.value = [];
  recalls.value = [];
  recallPending.value = null;
  savedAt = Date.now();
  hapticSaved();
  const id = memory.id;
  void loadToday().then((t) => {
    if (t && saved.value?.id === id && savedCount.value === null) savedCount.value = t.total;
  });
  // 離れている間に保存が終わったときは、戻ったときの recheckSaved が取り直して続ける
  if (alive && shown) polling.start();
  // 「保存する」は書く画面ごと消えるので、「残しました」の見出しへ（読み上げで残ったことが伝わる）
  void nextTick(() => focusHeading(savedHeading.value));
};

const another = () => {
  polling.stop();
  saved.value = null;
  facts.value = [];
  recalls.value = [];
  recallPending.value = null;
  savedCount.value = null;
  slipShown.value = false;
  precision.value = "day";
  date.value = todayInTokyo();
  dateTouched.value = false;
  sheetOpen.value = false; // 書く画面に戻ったとき、押していないのに日付のシートを開かない
  shownIds.value = new Set();
  now.value = new Date();
};

// 「もうひとつ書く」。ボタンは保存後の画面ごと消えるので、書く画面の見出しへ。入力欄に置くとスマホでキーボードが勝手に開く。
// another() は S3 で消したときや 404 でも呼ぶが、そちらは利用者の操作ではないのでフォーカスは動かさない
const writeAnother = () => {
  another();
  void nextTick(() => focusHeading(dateHeading.value));
};

// 残しておいた S1 に戻ってきたとき・アプリが表に戻ったとき・保存するとき。日をまたいで残っていても、触っていない既定の日付は今日にする
const refreshDefaultDate = () => {
  if (!saved.value && !dateTouched.value) date.value = todayInTokyo();
};
// S1 を開いたままアプリを裏に回し、翌朝戻ったとき（画面は切り替わらないので onActivated は呼ばれない）。見出しも今日にする
// 問いかけ・このごろ・あの日のひとことも、その日のものに取り直す
const onVisible = () => {
  if (document.visibilityState !== "visible") return;
  refreshDefaultDate();
  now.value = new Date();
  void loadToday();
};

// 保存した記憶を S3 で開いて戻ってきたとき、S3 で決めた候補・添え直した写真・届いた札を映す。
// まだ届いていない候補や札があれば、取り直しを映したあとで、保存から 30 秒の残りだけポーリングを続ける。
// 記憶が消えていたら（404）入力に戻す。ほかの失敗では表示は今のまま、届いたか分からないので残りの回数だけポーリングを続ける
const recheckSaved = async (id: string) => {
  try {
    const d = await api.getMemory(id);
    if (saved.value?.id !== id) return;
    // 写真は外せないので、取り直しの間に S3 からの知らせ（useMemoryPhoto）で足した写真を、それより前に読んだ応答で消さない
    const cur = saved.value;
    saved.value = d.memory.photo_key || !cur.photo_key ? d.memory : { ...d.memory, photo_key: cur.photo_key, photo_content_type: cur.photo_content_type };
    if (saved.value.photo_key) photoNote.value = "";
    facts.value = keepDecided(facts.value, d.facts.items);
    recalls.value = d.recalls.items;
    recallPending.value = d.recalls.pending;
    if (d.facts.pending || d.recalls.pending) resumePolling();
  } catch (e) {
    if (saved.value?.id !== id) return;
    if (e instanceof ApiError && e.status === 404) another();
    else resumePolling();
  }
};

onActivated(() => {
  shown = true;
  document.addEventListener("visibilitychange", onVisible);
  refreshDefaultDate();
  now.value = new Date();
  void loadToday();
  if (saved.value) void recheckSaved(saved.value.id);
});
// 離れるとき: ポーリングを止め、シートを閉じ（選んだ値はそのまま残る）、いま見えているカードと札を「見せた」に数える
onDeactivated(() => {
  shown = false;
  polling.stop();
  document.removeEventListener("visibilitychange", onVisible);
  sheetOpen.value = false;
  shownIds.value = new Set([...(saved.value ? [saved.value.id] : []), ...recalls.value.map((r) => r.id)]);
  if (facts.value.length > 0) slipShown.value = true;
  if (!saved.value) {
    if (today.value) leavesShown.value = true;
    if (today.value?.that_day) thatDayShown.value = today.value.that_day.memory.id;
    pressToday.value = false;
  }
});

// S3 で消した記憶のカードや札を残さない（非アクティブの間に届く）
useMemoryDeleted((id) => {
  if (saved.value?.id === id) another();
  else recalls.value = recalls.value.filter((r) => r.related_memory.id !== id);
});

// S3 で添え直した写真を映す（非アクティブの間に届く）。添えている途中に戻ると、戻ったときの取り直しが PUT より先に終わるため
useMemoryPhoto((id, photo_key, photo_content_type) => {
  if (saved.value?.id !== id) return;
  saved.value = { ...saved.value, photo_key, photo_content_type };
  photoNote.value = "";
});
</script>

<template>
  <!-- 書く前の画面（あいさつ・便箋・保存する・このごろ・あの日のひとこと）が iPhone（402 × 874pt）で、スクロールせずにひと目に収まる間隔（11/7 実機）。
       書いて便箋が伸びたら、そこからはスクロールしてよい -->
  <main class="flex flex-1 flex-col gap-5 py-4">
    <template v-if="!saved">
      <header class="flex flex-col gap-0.5">
        <div class="flex items-baseline justify-between">
          <h1 ref="dateHeading" class="text-[22px] focus:outline-none">{{ headingDate }}</h1>
          <!-- 押せる高さは 44pt のまま、上下の -6px で見出しの行を押し広げない（最初の画面をひと目に収める）。
               保存している間は押させない（POST はもう出ているので、選び直した日付は残らない。本文・写真と同じ止め方。見直し 3 回目） -->
          <button ref="whenButton" type="button" class="-my-1.5 min-h-11 px-2 text-sm text-ink-soft" :disabled="saving" @click="sheetOpen = true">いつ？</button>
        </div>
        <!-- 問いかけのあいさつ（時間帯・季節・日替わり）。見出しの下に小さく -->
        <p class="text-sm leading-[1.6] tracking-[.04em] text-ink-soft" data-greeting>{{ prompt.greeting }}</p>
      </header>

      <!-- 便箋（ADR-0010）: 空の朱罫が「書く場所」に見えるよう、4 行分の罫を最初から引いておく（5 行では最初の画面がスクロールになった。11/7 実機）。
           書いて行が増えると field-sizing: content で便箋が伸びる（iOS 27 の WebKit で 10 行まで伸びることを確かめた）。
           罫は文字と一緒に流れる（bg-local）。行送りと罫の間隔は同じ --leading-letter。
           下の段に写真（カメラの札と、添えた写真の焼き付け）。保存を押すと封をされるように小さく沈む -->
      <section class="card px-5 pt-[18px] pb-1.5" :class="sealing ? 'letter-sealing' : ''">
        <label class="sr-only" for="body">きょうのひとこと</label>
        <textarea
          id="body"
          v-model="body"
          rows="4"
          class="letter-text field-sizing-content block min-h-[calc(var(--leading-letter)_*_4_+_2em_/_17)] w-full resize-none bg-local text-ink outline-none"
          :placeholder="prompt.question"
          :readonly="saving"
        ></textarea>
        <p v-if="remaining < 100" class="text-right text-sm text-ink-soft" aria-live="polite">あと {{ remaining }} 文字</p>
        <PhotoPicker v-model="photo" variant="letter" :disabled="saving" @picking="photoPicking = $event" />
      </section>

      <!-- 鍵盤が出ている間は、鍵盤のすぐ上に貼り付く（styles/today.css の .today-save） -->
      <div class="today-save flex flex-col items-center gap-3" :style="{ '--today-shrink': `${keyboardShrink}px` }">
        <button class="btn btn-primary press px-10" type="button" :disabled="!canSave" @click="save">保存する</button>
        <!-- 保存に時間がかかるときだけ見える一文。下の並びを押し下げないよう、ボタンの下に重ねて置く。
             読み上げは <main> の終わりの知らせ（初めから置いてある role="status"）が受け持つ -->
        <p v-if="saving" class="today-saving absolute top-full right-0 left-0 mt-0.5 text-center text-sm leading-[1.4] text-ink-soft">残しています</p>
        <p v-if="error" class="text-sm text-ink-soft" role="alert">{{ error }}</p>
      </div>

      <!-- このごろ（7 日の押し葉）と、あの日のひとこと（無い日は出さない）。読めなかったときはどちらも出さない -->
      <DayLeaves v-if="today" :week="today.week" :season="season" :press-today="pressToday" :animate="!leavesShown" />
      <ThatDayLetter v-if="today?.that_day" :that-day="today.that_day" :animate="today.that_day.memory.id !== thatDayShown" />

      <DateSheet
        v-if="sheetOpen"
        v-model:precision="precision"
        v-model:date="date"
        @update:precision="dateTouched = true"
        @update:date="dateTouched = true"
        @close="closeSheet"
      />
    </template>

    <template v-else>
      <!-- 保存後の画面の h1（wireframes 6 節「画面ごとに h1 は 1 つ」）。保存したらここへフォーカスを置いて読ませるので role="status" は付けない。
           見た目はこれまでの 14px の添え書きのまま（h1 の字体・太さ・字間を本文に戻す。行間は text-sm が決める） -->
      <!-- 「残しました」の横に手書きの ✓（飾り）。右に控えめに「N こめのひとこと」（読めたときだけ） -->
      <div class="flex items-center gap-1.5">
        <h1 ref="savedHeading" class="font-body text-sm leading-[1.6] font-normal tracking-[.08em] text-ink-soft focus:outline-none">残しました</h1>
        <SavedCheck class="text-ember" :draw="!shownIds.has(saved.id)" />
        <p v-if="savedCount" class="saved-count ml-auto text-sm leading-[1.6] tracking-[.04em] text-ink-soft" :class="shownIds.has(saved.id) ? '' : 'is-fresh'">
          {{ savedCount }}こめのひとこと
        </p>
      </div>
      <!-- 便箋（ADR-0010）: 残したひとことは罫の上の明朝。候補はミシン目から下の控えに鉛筆書きで並ぶ。
           ミシン目の切り欠きがカードの縁にかかるので overflow-hidden は付けず、写真の角は写真の側で丸める -->
      <article class="card -mt-2" :class="shownIds.has(saved.id) ? '' : 'letter-sealed'">
        <PhotoImg v-if="saved.photo_key" :photo-key="saved.photo_key" class="h-[200px] w-full rounded-t-[13px] object-cover" />
        <div class="px-5 pt-[18px] pb-5">
          <p class="text-sm leading-[1.6] tracking-[.04em] text-ink-soft">{{ formatHappenedOn(saved.happened_on, saved.happened_on_precision) }}</p>
          <p class="letter-text mt-2.5 whitespace-pre-wrap text-ink">{{ saved.body }}</p>
        </div>
        <!-- 候補が届いたら、ミシン目の下から控えがすべり出て、候補が少しずつずれて現れる（一度だけ） -->
        <template v-if="facts.length > 0">
          <div class="perf" aria-hidden="true"></div>
          <div class="slip-reveal" :class="slipShown ? '' : 'is-entering'">
            <div class="slip px-5 pt-4 pb-3">
              <FactChips :facts="facts" :stagger="!slipShown" />
            </div>
          </div>
        </template>
      </article>
      <!-- 写真だけ失敗したとき: 案内のすぐ下に、いま書いた記憶の S3（「写真を添える」がある）へのリンクを置く。
           札の「ひらく ›」（昔の記憶へ）と取り違えないよう、行き先を文言で言う。読み上げが文だけで済むよう alert の外に置く -->
      <div v-if="photoNote" class="flex flex-col items-start">
        <p class="text-sm text-ink-soft" role="alert">{{ photoNote }}</p>
        <a :href="hrefFor({ name: 'memory', id: saved.id, from: 'today' })" class="inline-flex min-h-11 items-center text-sm text-ink-soft">写真を添え直す ›</a>
      </div>
      <!-- 札を待つ間。届いたら札に入れ替わり、届かずに終わったら静かに消える -->
      <WaitingThread v-if="waiting || waitingLeaving" :leaving="!waiting" />
      <RecallCard v-for="r in recalls" :key="r.id" :recall="r" from="today" :animate="!shownIds.has(r.id)" />
      <div class="-mt-1 flex flex-wrap items-baseline gap-x-6">
        <button type="button" class="inline-flex min-h-11 items-center tracking-[.04em] text-ink" @click="writeAnother"><span class="ember-underline">もうひとつ書く</span></button>
        <!-- いま書いた記憶へ。札の「ひらく ›」は昔の記憶へ行くので、同じ文言にしない -->
        <a :href="hrefFor({ name: 'memory', id: saved.id, from: 'today' })" class="inline-flex min-h-11 items-center text-sm tracking-[.04em] text-ink-soft">このひとことをひらく ›</a>
      </div>
    </template>

    <!-- 読み上げの知らせ（「残しています」「思い出しています」）。書く画面と保存後の画面の切り替えの外に初めから置き、文字だけ入れ替える。
         sr-only は absolute なので、並びの間（gap）を増やさない -->
    <p class="sr-only" role="status" aria-live="polite" data-live>{{ liveText }}</p>
  </main>
</template>
