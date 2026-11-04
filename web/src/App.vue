<script setup lang="ts">
import { onMounted, ref } from "vue";
import { api, ApiError, type Me } from "./api";
import BottomNav from "./components/BottomNav.vue";
import { useScreen } from "./composables/useScreen";
import MemoryDetailScreen from "./screens/MemoryDetailScreen.vue";
import TimelineScreen from "./screens/TimelineScreen.vue";
import TodayScreen from "./screens/TodayScreen.vue";
import WelcomeScreen from "./screens/WelcomeScreen.vue";

type State = { kind: "loading" } | { kind: "signed_out" } | { kind: "ready"; me: Me } | { kind: "trouble" };

const state = ref<State>({ kind: "loading" });
const { screen } = useScreen();

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
  <div class="mx-auto flex min-h-dvh w-full max-w-md flex-col px-5">
    <!-- 読み込み中は何も主張しない -->
    <main v-if="state.kind === 'loading'" class="flex flex-1 items-center justify-center" aria-busy="true">
      <p class="text-ink-faint" aria-hidden="true">…</p>
      <p class="sr-only" role="status">読み込んでいます</p>
    </main>

    <WelcomeScreen v-else-if="state.kind === 'signed_out'" @start="retry" />

    <main v-else-if="state.kind === 'trouble'" class="flex flex-1 flex-col items-center justify-center gap-4 text-center">
      <h1 class="text-2xl">そういえば。</h1>
      <p class="text-ink-soft" role="alert">いま、うまくつながりません。</p>
      <button class="btn btn-quiet" @click="retry">もう一度</button>
    </main>

    <template v-else>
      <TodayScreen v-if="screen.name === 'today'" />
      <TimelineScreen v-else-if="screen.name === 'past'" />
      <MemoryDetailScreen v-else :id="screen.id" :from="screen.from" />
      <BottomNav :current="screen.name === 'past' || (screen.name === 'memory' && screen.from === 'past') ? 'past' : 'today'" />
    </template>
  </div>
</template>
