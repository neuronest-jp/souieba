<script setup lang="ts">
import { onMounted, ref } from "vue";
import { api, ApiError, type Me } from "./api";
import BottomNav, { type Tab } from "./components/BottomNav.vue";
import TimelineScreen from "./screens/TimelineScreen.vue";
import TodayScreen from "./screens/TodayScreen.vue";
import WelcomeScreen from "./screens/WelcomeScreen.vue";

type State = { kind: "loading" } | { kind: "signed_out" } | { kind: "ready"; me: Me } | { kind: "trouble" };

const state = ref<State>({ kind: "loading" });
const tab = ref<Tab>("today");

onMounted(async () => {
  try {
    const me = await api.me();
    state.value = { kind: "ready", me };
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) state.value = { kind: "signed_out" };
    else state.value = { kind: "trouble" };
  }
});

const retry = () => window.location.reload();
</script>

<template>
  <div class="mx-auto flex min-h-dvh w-full max-w-md flex-col px-4">
    <!-- 読み込み中は何も主張しない -->
    <main v-if="state.kind === 'loading'" class="flex flex-1 items-center justify-center">
      <p class="text-ink-faint">…</p>
    </main>

    <WelcomeScreen v-else-if="state.kind === 'signed_out'" @start="retry" />

    <main v-else-if="state.kind === 'trouble'" class="flex flex-1 flex-col items-center justify-center gap-4 text-center">
      <h1 class="text-2xl">そういえば。</h1>
      <p class="text-ink-soft">いま、うまくつながりません。</p>
      <button class="btn btn-quiet" @click="retry">もう一度</button>
    </main>

    <template v-else>
      <TodayScreen v-if="tab === 'today'" :me="state.me" />
      <TimelineScreen v-else />
      <BottomNav v-model="tab" />
    </template>
  </div>
</template>
