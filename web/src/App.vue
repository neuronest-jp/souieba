<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from "vue";
import { api, ApiError, type Me } from "./api";
import { clearToken, loadToken } from "./auth";
import BottomNav from "./components/BottomNav.vue";
import { focusScreenHeading, leavingScrollY, useScreen, type From } from "./composables/useScreen";
import { pinLeaving, prefersMotion, unpinLeaving } from "./motion";
import SplashOverlay from "./components/SplashOverlay.vue";
import { hideSplash, isNative, platform } from "./native";
import ConnectionsScreen from "./screens/ConnectionsScreen.vue";
import MemoryDetailScreen from "./screens/MemoryDetailScreen.vue";
import TimelineScreen from "./screens/TimelineScreen.vue";
import TodayScreen from "./screens/TodayScreen.vue";
import WelcomeScreen from "./screens/WelcomeScreen.vue";

type State = { kind: "loading" } | { kind: "signed_out" } | { kind: "ready"; me: Me } | { kind: "trouble" };

const state = ref<State>({ kind: "loading" });

// 起動のときの「そういえば。」の動き。ネイティブでだけ出す（Web の開発では ?splash か ?splash=ios で確かめられる）。
// iOS は起動画面と同じ絵から引き継ぐ（seamless）。Android は起動画面がアイコンなので、ふわっと出してから動かす
const splashParam = import.meta.env.DEV ? new URLSearchParams(window.location.search).get("splash") : null;
const splash = ref(isNative() || splashParam !== null);
const splashSeamless = platform() === "ios" || splashParam?.startsWith("ios") === true;
const splashHold = splashParam?.endsWith("-hold") === true; // ?splash=ios-hold は消さずに止める（動きの確認用）
const { screen, motion } = useScreen();
// 下部ナビの現在地。S3 は開いた元の画面（from）を示す（戻る先と同じ）
const navCurrent = computed<From>(() => (screen.value.name === "memory" ? screen.value.from : screen.value.name));

// 画面の移り変わり（ブラッシュアップ 11/7。動きの種類と時間は style.css の screen-*、向きは useScreen の motion）。
// 動きを減らす設定と最初の表示では css を切り、待たずに入れ替える（位置とフォーカスの扱いは useScreen のまま）
const animated = computed(() => motion.value !== "none" && prefersMotion());
// S3 の下になる画面を暗くする薄い墨（push / pop の間だけ）
const shade = ref<"push" | "pop" | null>(null);
// 離れていく画面は見ていた位置のまま留め、終わったら元に戻す（motion.ts の pinLeaving / unpinLeaving）
const onBeforeLeave = (el: Element) => {
  if (animated.value) pinLeaving(el as HTMLElement, leavingScrollY());
};
const onAfterLeave = (el: Element) => unpinLeaving(el as HTMLElement);
const onBeforeEnter = () => {
  shade.value = animated.value && (motion.value === "push" || motion.value === "pop") ? motion.value : null;
};
// push の終わりに、離れた画面がまだ残っていたら（終わりの知らせが別のフレームに分かれたとき）消しておく。
// S3 の紙の地は入り終わると外れるので、残った前の画面が 1 フレーム透けて見えないように
const onAfterEnter = () => {
  if (shade.value === "push") document.querySelectorAll<HTMLElement>("main[data-leaving]").forEach((el) => (el.style.opacity = "0"));
  shade.value = null;
};

const boot = async () => {
  state.value = { kind: "loading" };
  const token = await loadToken();
  // Web の開発（X-Dev-User を Vite の proxy が付ける）ではトークンが無くても /api/me が通ることがある
  try {
    const me = await api.me();
    state.value = { kind: "ready", me };
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) state.value = { kind: "signed_out" };
    else if (!token) state.value = { kind: "signed_out" };
    else state.value = { kind: "trouble" };
  } finally {
    await hideSplash();
  }
};

const onLoggedIn = (userId: string) => {
  state.value = { kind: "ready", me: { user_id: userId, display_name: null, since: new Date().toISOString() } };
  if (!window.location.hash) window.location.hash = "#today"; // 深いリンクで開いていたらそのまま
  // 「はじめる」は S0 ごと消えるので、S1 / S2 の h1 へ（ハッシュが変わらないと useScreen は動かない。S3 は読み込み後に自分で置く）
  void nextTick(() => focusScreenHeading());
};

// どの画面でも /api/* が 401 を返したら S0 へ戻す（wireframes 0 節）
const onUnauthorized = async () => {
  await clearToken();
  state.value = { kind: "signed_out" };
};

// iPhone の WebKit は、どこかに touchstart の受け手が無いと :active を付けない（押したときに沈む .press が効かない）。何もしない受け手を置く
const noop = () => {};
onMounted(() => {
  window.addEventListener("souieba:unauthorized", onUnauthorized);
  document.addEventListener("touchstart", noop, { passive: true });
  void boot();
});
onUnmounted(() => {
  window.removeEventListener("souieba:unauthorized", onUnauthorized);
  document.removeEventListener("touchstart", noop);
});
</script>

<template>
  <SplashOverlay
    v-if="splash"
    :ready="state.kind !== 'loading' && !splashHold"
    :seamless="splashSeamless"
    @shown="hideSplash"
    @done="splash = false"
  />
  <!-- ステータスバーの下の地。一覧をスクロールしても時計に本文が重ならないようにする（ブラウザでは env() が 0 で高さ 0） -->
  <div
    class="tex-desk pointer-events-none fixed inset-x-0 top-0 z-10 h-[env(safe-area-inset-top)] bg-paper"
    aria-hidden="true"
  ></div>
  <!-- touch-pan-y: 横へなぞってもスクロールを始めない（S3 の左端からなぞって戻る手ざわりを WebKit に取られない。横に動くものは無い） -->
  <div class="safe-area mx-auto flex min-h-dvh w-full max-w-[560px] touch-pan-y touch-pinch-zoom flex-col">
    <!-- 読み込み中は何も主張しない -->
    <main v-if="state.kind === 'loading'" class="flex flex-1 items-center justify-center" aria-busy="true">
      <p class="text-ink-faint" aria-hidden="true">…</p>
      <p class="sr-only" role="status">読み込んでいます</p>
    </main>

    <WelcomeScreen v-else-if="state.kind === 'signed_out'" @done="onLoggedIn" />

    <main v-else-if="state.kind === 'trouble'" class="flex flex-1 flex-col items-center justify-center gap-4 text-center">
      <h1 class="text-2xl">そういえば。</h1>
      <p class="text-ink-soft" role="alert">いま、うまくつながりません。</p>
      <button class="btn btn-quiet" @click="boot">もう一度</button>
    </main>

    <template v-else>
      <!-- S1（書きかけ・残しました・候補・札）、S2（読み込んだ一覧）、S5（つながりの一覧）は画面を行き来しても残す（wireframes 0 節）。
           S3 は開くたびに読み直す。401 で S0 に戻ると v-else ごと外れ、残した画面も捨てる -->
      <!-- 画面の移り変わり（style.css の screen-*）。S3 は記憶ごとに作り直す（:key。札の相手の S3 へも押し出しで移る） -->
      <Transition
        :name="`screen-${motion}`"
        :css="animated"
        @before-leave="onBeforeLeave"
        @after-leave="onAfterLeave"
        @leave-cancelled="onAfterLeave"
        @before-enter="onBeforeEnter"
        @after-enter="onAfterEnter"
        @enter-cancelled="onAfterEnter"
      >
        <KeepAlive include="TodayScreen,TimelineScreen,ConnectionsScreen">
          <TodayScreen v-if="screen.name === 'today'" />
          <TimelineScreen v-else-if="screen.name === 'past'" />
          <ConnectionsScreen v-else-if="screen.name === 'connections'" />
          <MemoryDetailScreen v-else :key="`memory:${screen.id}`" :id="screen.id" :from="screen.from" :recall="screen.recall" />
        </KeepAlive>
      </Transition>
      <div v-if="shade" class="screen-shade" :data-shade="shade" aria-hidden="true"></div>
      <BottomNav :current="navCurrent" />
    </template>
  </div>
</template>
