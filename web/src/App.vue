<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
import { api, ApiError, type Me } from "./api";
import { clearToken, loadToken } from "./auth";
import BottomNav from "./components/BottomNav.vue";
import { useScreen } from "./composables/useScreen";
import { hideSplash } from "./native";
import MemoryDetailScreen from "./screens/MemoryDetailScreen.vue";
import TimelineScreen from "./screens/TimelineScreen.vue";
import TodayScreen from "./screens/TodayScreen.vue";
import WelcomeScreen from "./screens/WelcomeScreen.vue";

type State = { kind: "loading" } | { kind: "signed_out" } | { kind: "ready"; me: Me } | { kind: "trouble" };

const state = ref<State>({ kind: "loading" });
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
      <TodayScreen v-if="screen.name === 'today'" />
      <TimelineScreen v-else-if="screen.name === 'past'" />
      <MemoryDetailScreen v-else :id="screen.id" :from="screen.from" />
      <BottomNav :current="screen.name === 'past' || (screen.name === 'memory' && screen.from === 'past') ? 'past' : 'today'" />
    </template>
  </div>
</template>
