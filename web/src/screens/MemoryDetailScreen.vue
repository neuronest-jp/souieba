<script setup lang="ts">
// S3 記憶の詳細。本文、起きた日、確定済みの事実、「そういえば。」の枠、削除。
// 写真の無い記憶には「写真を添える」を出す（S1 で写真だけ失敗したときの添え直し先）。
// 札の「ひらく ›」から来たとき（?recall=）は、その札を本文のすぐ下に反応ボタン付きで出す（wireframes 4.2）。
// 手ざわり（ブラッシュアップ 11/7）: 左端からなぞって戻る（useEdgeSwipe）。「消しますか」のシートは下へなぞっても閉じる（useSheetDrag）。
// 触覚は、反応の記録の失敗と写真を添えられなかったときに failed、添えられたときに saved（「そうだった」の stamp は RecalledByCard）。
// 「そういえば。」の札が現れる動きと届いた触覚は、この画面を開いたあとにポーリングで届いた札だけ（開いたときからある札は動かさない）
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { api, ApiError } from "../api";
import PhotoImg from "../components/PhotoImg.vue";
import PhotoPicker from "../components/PhotoPicker.vue";
import { PHOTO_MAX_BYTES, shrinkPhoto } from "../photo";
import type { MemoryDetail, RecalledBy } from "../api/types";
import FactChips from "../components/FactChips.vue";
import RecallCard from "../components/RecallCard.vue";
import RecalledByCard from "../components/RecalledByCard.vue";
import Ribbon from "../components/motifs/Ribbon.vue";
import { formatHappenedOn } from "../date";
import { useNotice } from "../composables/useNotice";
import { usePolling } from "../composables/usePolling";
import { notifyMemoryDeleted } from "../composables/useMemoryDeleted";
import { notifyMemoryPhoto } from "../composables/useMemoryPhoto";
import { back as goBack, focusHeading, go, type From } from "../composables/useScreen";
import { useEdgeSwipe } from "../composables/useEdgeSwipe";
import { useSheetDrag } from "../composables/useSheetDrag";
import { firstLine } from "../date";
import { keepDecided } from "../facts";
import { failed, saved } from "../haptics";

const props = defineProps<{ id: string; from: From; recall?: string }>();

const detail = ref<MemoryDetail | null>(null);
const state = ref<"loading" | "ready" | "missing" | "error">("loading");
const confirming = ref(false);
const deleting = ref(false);
const deleteError = ref("");
const deleteButton = ref<HTMLButtonElement | null>(null);
const cancelButton = ref<HTMLButtonElement | null>(null);
const heading = ref<HTMLElement | null>(null);
const root = ref<HTMLElement | null>(null);

const openConfirm = () => {
  confirming.value = true;
  void nextTick(() => cancelButton.value?.focus());
};
// 「消しますか」のシート。やめる・地を押す・Esc・下へなぞるで、紙が下がってから閉じる
const finishCloseConfirm = () => {
  confirming.value = false;
  void nextTick(() => deleteButton.value?.focus());
};
const { panel: confirmPanel, backdrop: confirmBackdrop, close: closeConfirm } = useSheetDrag({ onClose: finishCloseConfirm });
const onKey = (e: KeyboardEvent) => {
  if (e.key === "Escape" && confirming.value) closeConfirm();
};
onMounted(() => window.addEventListener("keydown", onKey));
// S3 は KeepAlive で残さないので、離れると外れる。読み込み中に離れたとき、外れた画面の続き（状態の書き込み・ポーリング・フォーカス）をしない
let alive = true;
onUnmounted(() => {
  alive = false;
  window.removeEventListener("keydown", onKey);
});

// 候補や札がまだ届いていない記憶（保存した直後に開いたときなど）は、届くまで静かに取り直す。
// 間隔と打ち切りは S1 と同じ（2 秒、30 秒）。文言は出さない。書き換えるのは facts と recalls だけで、
// 本文・写真・recalled_by（反応の印）には触らない。候補は画面で決めた印を残して重ねる。
// 取り直しで新しく届いた札は arrived に入れ、その札だけ現れる動きと届いた触覚を付ける
const arrived = ref(new Set<string>());
const polling = usePolling(
  () => api.getMemory(props.id),
  (d) => !d.facts.pending && !d.recalls.pending,
);
watch(
  () => polling.value.value,
  (d) => {
    const cur = detail.value;
    if (!d || !cur || d.memory.id !== cur.memory.id) return;
    cur.facts = { pending: d.facts.pending, items: keepDecided(cur.facts.items, d.facts.items) };
    const known = new Set(cur.recalls.items.map((r) => r.id));
    for (const r of d.recalls.items) if (!known.has(r.id)) arrived.value.add(r.id);
    cur.recalls = d.recalls;
  },
);

const load = async () => {
  polling.stop();
  const id = props.id;
  state.value = "loading";
  try {
    const d = await api.getMemory(id);
    if (!alive || id !== props.id) return; // その間に画面を離れた、または別の記憶へ移った
    detail.value = d;
    state.value = "ready";
    if (d.facts.pending || d.recalls.pending) polling.start();
    // h1（起きた日）は読み込みが終わってから描かれるので、画面を開いたときのフォーカスはここで置く（useScreen の分は空振りする）。
    // 押したリンクや「もう一度」が消えて body に落ちているときだけ動かす
    void nextTick(() => focusHeading(heading.value));
  } catch (e) {
    if (!alive || id !== props.id) return;
    state.value = e instanceof ApiError && e.status === 404 ? "missing" : "error";
    // 見つからない・読み込めないときは、その一文（この画面の h1）へ置く。読み込み中の S3 には h1 が無く、
    // useScreen の分は空振りしているので、置かないと body に落ちたまま画面が変わったことが読まれない。
    // 成功のときと同じく、押したリンクや「もう一度」が消えて body に落ちているときだけ動かす
    void nextTick(() => focusHeading(heading.value));
  }
};

// 候補と確定済みを並べる。却下は描かない（architecture 4.3）
const visibleFacts = computed(() => detail.value?.facts.items.filter((f) => f.status !== "rejected") ?? []);

// 本文中の引用（recalled_by の evidence）を強調する。最初の一致だけ（X-7）
const bodyParts = computed(() => {
  const d = detail.value;
  if (!d) return [] as Array<{ text: string; hit: boolean }>;
  const body = d.memory.body;
  const evidences = d.recalled_by.items.map((r) => r.evidence).filter((e) => e && body.includes(e));
  if (evidences.length === 0) return [{ text: body, hit: false }];
  const ranges = evidences
    .map((e) => ({ start: body.indexOf(e), end: body.indexOf(e) + e.length }))
    .sort((a, b) => a.start - b.start);
  const parts: Array<{ text: string; hit: boolean }> = [];
  let pos = 0;
  for (const r of ranges) {
    if (r.start < pos) continue; // 重なりは最初のものだけ
    if (r.start > pos) parts.push({ text: body.slice(pos, r.start), hit: false });
    parts.push({ text: body.slice(r.start, r.end), hit: true });
    pos = r.end;
  }
  if (pos < body.length) parts.push({ text: body.slice(pos), hit: false });
  return parts;
});

// 札から開いたときの札（recalled_by のうち ?recall= と同じ id）。見つからなければ 4.1 の並びのまま
const pinned = computed(() => (props.recall ? (detail.value?.recalled_by.items.find((r) => r.id === props.recall) ?? null) : null));
const restRecalledBy = computed(() => detail.value?.recalled_by.items.filter((r) => r.id !== pinned.value?.id) ?? []);

const feedbackBusy = ref<Set<string>>(new Set());
const feedbackNotice = useNotice();
const noticeFor = (r: RecalledBy) => (feedbackNotice.key.value === r.id ? feedbackNotice.message.value : "");
const react = async (r: RecalledBy, feedback: "helpful" | "not_related") => {
  if (feedbackBusy.value.has(r.id)) return;
  feedbackBusy.value.add(r.id);
  const prev = r.feedback;
  r.feedback = r.feedback === feedback ? "none" : feedback; // 同じ札をもう一度押すと取り消し
  try {
    await api.recallFeedback(r.id, r.feedback);
  } catch {
    r.feedback = prev; // 印を戻し、その札の下にそっと知らせる（F6 エラー時）
    failed();
    feedbackNotice.show("記録できませんでした", r.id);
  } finally {
    feedbackBusy.value.delete(r.id);
  }
};

const remove = async () => {
  deleting.value = true;
  deleteError.value = "";
  try {
    await api.deleteMemory(props.id);
    notifyMemoryDeleted(props.id); // 残してある S1 / S2 から消す
    // シートは先に外す（開いたままだと、出ていく S3 と一緒に滑って見える）
    confirming.value = false;
    go({ name: "past" });
  } catch {
    failed();
    finishCloseConfirm();
    deleteError.value = "消せませんでした";
  } finally {
    deleting.value = false;
  }
};

// 写真をあとから添える。新しい API は使わず PUT /api/memories/:id/photo（S1 と同じ）。本文には触らない。
// 「写真を添える」は選んだ時点で「写真を添えています」に替わって消え、添えられると区画ごと消えるので、
// 終わったら起きた日の h1 へフォーカスを置き（body に落ちているときだけ）、結果をいつも描いてある status で伝える（見直し n=13）。
// 失敗は alert で伝えるので status は空に戻す
const addingPhoto = ref<File | null>(null);
const photoBusy = ref(false);
const photoError = ref("");
const photoStatus = ref("");
watch(addingPhoto, async (file) => {
  if (!file || photoBusy.value) return;
  const id = props.id;
  photoBusy.value = true;
  photoError.value = "";
  photoStatus.value = "写真を添えています";
  try {
    const blob = await shrinkPhoto(file);
    if (blob.size > PHOTO_MAX_BYTES) throw new Error("too large");
    const r = await api.putPhoto(id, blob);
    // 残してある S1 / S2 にも映す。添えている途中に離れても届くよう、この画面の状態とは関係なく知らせる
    notifyMemoryPhoto(id, r.photo_key, r.photo_content_type);
    if (detail.value && detail.value.memory.id === id) {
      detail.value.memory = { ...detail.value.memory, photo_key: r.photo_key, photo_content_type: r.photo_content_type };
    }
    photoStatus.value = "写真を添えました";
    saved();
  } catch {
    photoStatus.value = "";
    photoError.value = "写真を添えられませんでした。もう一度どうぞ";
    failed();
  } finally {
    addingPhoto.value = null;
    photoBusy.value = false;
    if (alive) void nextTick(() => focusHeading(heading.value));
  }
});

// 戻る先は開いた元の画面（アプリの外から直接開いたときの既定も同じ）。文言はその画面の名前
const back = () => goBack({ name: props.from });
const BACK_LABEL: Record<From, string> = { today: "きょう", past: "これまで", connections: "つながり" };
// 左端からなぞって戻る（「消しますか」のシートが出ている間は拾わない）
useEdgeSwipe(root, { onBack: () => goBack({ name: props.from }, { swipe: true }), enabled: () => !confirming.value });

onMounted(load);
watch(() => props.id, load);
</script>

<template>
  <main ref="root" class="flex flex-1 flex-col gap-4 py-4">
    <button type="button" class="press self-start min-h-11 tracking-[.04em] text-ink-soft" @click="back">‹ {{ BACK_LABEL[from] }}</button>

    <p v-if="state === 'loading'" class="py-16 text-center text-sm text-ink-soft" role="status">よみこみ中</p>
    <!-- 見つからない・読み込めないときの一文は、見出しの位置に出すこの画面の h1（wireframes 4 節、6 節「画面ごとに h1 は 1 つ」）。
         字体・大きさ・太さ・行間は本文のまま（style.css の h1 の既定を打ち消す。大きさは preflight で親のまま） -->
    <h1 v-else-if="state === 'missing'" ref="heading" class="py-16 text-center font-body font-normal leading-[inherit] tracking-normal text-ink-soft focus:outline-none">この記憶は見つかりませんでした</h1>
    <section v-else-if="state === 'error'" class="flex flex-col items-center gap-3 py-16">
      <h1 ref="heading" class="font-body font-normal leading-[inherit] tracking-normal text-ink-soft focus:outline-none">読み込めませんでした</h1>
      <button type="button" class="btn btn-quiet press" @click="load">もう一度</button>
    </section>

    <template v-else-if="detail">
      <h1 ref="heading" class="text-[24px] tracking-[.04em] [font-feature-settings:'palt'] focus:outline-none">{{ formatHappenedOn(detail.memory.happened_on, detail.memory.happened_on_precision) }}</h1>
      <!-- 写真は比率のまま出し、縦長でも上下を切らない（S3 は写真全体を見られる唯一の場所。wireframes 4.1）。
           横長は幅いっぱい、縦長は高さ 360px まで縮めて中央に置く。img を main（flex）の子にすると伸び縮みで比率が崩れうるので、
           ふつうの div に入れる。読み込み中と読めなかったときの枠は、これまでどおり幅いっぱい・高さ 120px -->
      <div v-if="detail.memory.photo_key">
        <PhotoImg :photo-key="detail.memory.photo_key" :alt="firstLine(detail.memory.body)" class="mx-auto block max-h-[360px] max-w-full rounded-card" box-class="h-[120px] w-full rounded-card" />
      </div>
      <!-- 本文は地にじかに置かず、便箋に罫の上の明朝で（ADR-0010）。思い出されたことのある記憶（recalled_by がある）だけ、
           便箋の天に朱の栞を垂らす。本文の引用の範囲は蛍光ペンの印（style.css の mark） -->
      <article class="card relative px-5 pt-[18px] pb-5">
        <Ribbon v-if="detail.recalled_by.items.length > 0" class="absolute -top-[9px] right-[26px] drop-shadow-wax" />
        <p class="letter-text whitespace-pre-wrap text-ink">
          <template v-for="(p, i) in bodyParts" :key="i">
            <mark v-if="p.hit">{{ p.text }}</mark>
            <template v-else>{{ p.text }}</template>
          </template>
        </p>
      </article>

      <RecalledByCard v-if="pinned" :item="pinned" heading :notice="noticeFor(pinned)" @react="(f) => react(pinned!, f)" />

      <!-- 写真の結果の読み上げ。区画が消えても伝わるよう、区画の外にいつも描いておく -->
      <p class="sr-only" role="status">{{ photoStatus }}</p>
      <div v-if="!detail.memory.photo_key" class="flex flex-col gap-2">
        <p v-if="photoBusy" class="text-sm text-ink-soft">写真を添えています</p>
        <PhotoPicker v-else v-model="addingPhoto" />
        <p v-if="photoError" class="text-sm text-ink-soft" role="alert">{{ photoError }}</p>
      </div>

      <!-- 却下は描かない（visibleFacts）が、部品は事実が 1 件でもあれば外さない。見えている最後の候補を「ちがう」にしても、
           読み上げと失敗の知らせを同じ部品に残し、行も見出しも消えたらフォーカスを起きた日の h1 へ置く（wireframes 6 節） -->
      <FactChips v-if="detail.facts.items.length > 0" class="mt-6" :facts="visibleFacts" :fallback="heading" title="おぼえていること" variant="page" />

      <section v-if="restRecalledBy.length > 0 || detail.recalls.items.length > 0" class="mt-6 flex flex-col gap-3.5">
        <h2 class="font-display text-[22px] font-bold tracking-[.06em] text-ember-ink [font-feature-settings:'palt']">そういえば。</h2>
        <!-- この記憶が思い出された側（相手 = 新しい記憶）。反応はここで返す。本文の下に出した札はここに重ねない -->
        <RecalledByCard v-for="r in restRecalledBy" :key="r.id" :item="r" :notice="noticeFor(r)" @react="(f) => react(r, f)" />
        <!-- この記憶を書いたとき浮かんだ札（相手 = 昔の記憶） -->
        <RecallCard v-for="r in detail.recalls.items" :key="r.id" :recall="r" :from="from" :heading="false" :animate="arrived.has(r.id)" />
      </section>

      <div class="mt-auto flex flex-col items-end gap-3 pt-6">
        <p v-if="deleteError" class="text-sm text-ink-soft" role="alert">{{ deleteError }}</p>
        <button ref="deleteButton" type="button" class="press min-h-11 px-2 text-sm tracking-[.06em] text-ink-soft" @click="openConfirm">消す</button>
      </div>

      <!-- 下からのシート（DateSheet と同じ手ざわり。useSheetDrag）。紙はばねで上がり、下へなぞる・地を押す・やめる・Esc で下がって閉じる -->
      <div v-if="confirming" class="sheet-host fixed inset-0 z-20 flex items-end justify-center">
        <div ref="confirmBackdrop" class="sheet-backdrop absolute inset-0 bg-ink/30" aria-hidden="true" @click="closeConfirm"></div>
        <div ref="confirmPanel" class="sheet-paper tex-sheet relative w-full max-w-[560px] rounded-t-[20px] bg-card px-5 pt-5 pb-[max(20px,env(safe-area-inset-bottom))] shadow-card" role="dialog" aria-modal="true" aria-labelledby="delete-title">
          <div class="sheet-grip" aria-hidden="true"></div>
          <h2 id="delete-title" class="text-[22px]">この記憶を消しますか</h2>
          <!-- 札はこの記憶から浮かんだ側も、この記憶が思い出された側も消える（recalls の 2 つの外部キーの ON DELETE CASCADE）ので「つながった」と言う -->
          <p class="mt-2 text-sm text-ink-soft">写真も、この記憶につながった「そういえば。」も一緒に消えます。</p>
          <div class="mt-5 flex flex-col items-center gap-3">
            <button type="button" class="btn btn-primary press px-10" :disabled="deleting" @click="remove">消す</button>
            <button ref="cancelButton" type="button" class="press min-h-11 px-4 text-ink-soft" @click="closeConfirm">やめる</button>
          </div>
        </div>
      </div>
    </template>
  </main>
</template>
