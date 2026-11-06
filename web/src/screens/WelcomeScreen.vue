<script setup lang="ts">
// S0 ようこそ（ログイン）。招待コードとメールアドレスだけ。パスワードは無い（ADR-0007）。
import { computed, ref } from "vue";
import { api, ApiError } from "../api";
import { saveToken } from "../auth";

const emit = defineEmits<{ done: [userId: string] }>();

const code = ref("");
const email = ref("");
const busy = ref(false);
const error = ref("");

const canStart = computed(() => code.value.trim().length > 0 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value.trim()) && !busy.value);

const start = async () => {
  if (!canStart.value) return;
  busy.value = true;
  error.value = "";
  try {
    const r = await api.login(code.value.trim(), email.value.trim());
    await saveToken(r.token, r.user_id);
    emit("done", r.user_id);
  } catch (e) {
    if (e instanceof ApiError && (e.status === 401 || e.status === 400)) error.value = "招待コードかメールアドレスが違うようです";
    else if (e instanceof ApiError && e.status === 429) error.value = "少し待ってから、もう一度";
    else error.value = "いま、うまくつながりません";
  } finally {
    busy.value = false;
  }
};
</script>

<template>
  <main class="flex flex-1 flex-col justify-center gap-8 py-16">
    <div class="space-y-3 text-center">
      <h1 class="text-3xl tracking-tight">そういえば。</h1>
      <p class="text-ink-soft">
        きょうのひとことを残しておくと、<br />
        いつか、ふと思い出すきっかけになります。
      </p>
    </div>
    <form class="card flex flex-col gap-4 p-5" @submit.prevent="start">
      <label class="flex flex-col gap-1">
        <span class="text-sm text-ink-soft">招待コード</span>
        <input v-model="code" type="text" autocomplete="one-time-code" autocapitalize="off" spellcheck="false" class="h-12 rounded-xl bg-fill px-4 outline-none focus:ring-2 focus:ring-ember" />
      </label>
      <label class="flex flex-col gap-1">
        <span class="text-sm text-ink-soft">メールアドレス</span>
        <input v-model="email" type="email" autocomplete="email" inputmode="email" autocapitalize="off" class="h-12 rounded-xl bg-fill px-4 outline-none focus:ring-2 focus:ring-ember" />
      </label>
      <button class="btn btn-primary mt-2 w-full" type="submit" :disabled="!canStart">はじめる</button>
      <p v-if="error" class="text-center text-sm text-ink-soft" role="alert">{{ error }}</p>
    </form>
    <p class="text-center text-sm text-ink-soft">招待コードは、お渡ししたものを入れてください</p>
  </main>
</template>
