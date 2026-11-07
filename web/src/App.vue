<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref } from "vue";
import { api, ApiError, type Me } from "./api";
import { clearToken, loadToken } from "./auth";
import BottomNav from "./components/BottomNav.vue";
import { focusScreenHeading, useScreen } from "./composables/useScreen";
import SplashOverlay from "./components/SplashOverlay.vue";
import { hideSplash, isNative, platform } from "./native";
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
const { screen } = useScreen();

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

onMounted(() => {
  window.addEventListener("souieba:unauthorized", onUnauthorized);
  void boot();
});
onUnmounted(() => window.removeEventListener("souieba:unauthorized", onUnauthorized));
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
  <div class="safe-area mx-auto flex min-h-dvh w-full max-w-[560px] flex-col">
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
      <!-- S1（書きかけ・残しました・候補・札）と S2（読み込んだ一覧）は画面を行き来しても残す（wireframes 0 節）。
           S3 は開くたびに読み直す。401 で S0 に戻ると v-else ごと外れ、残した画面も捨てる -->
      <KeepAlive include="TodayScreen,TimelineScreen">
        <TodayScreen v-if="screen.name === 'today'" />
        <TimelineScreen v-else-if="screen.name === 'past'" />
        <MemoryDetailScreen v-else :id="screen.id" :from="screen.from" :recall="screen.recall" />
      </KeepAlive>
      <BottomNav :current="screen.name === 'past' || (screen.name === 'memory' && screen.from === 'past') ? 'past' : 'today'" />
    </template>
  </div>
</template>
