<script setup lang="ts">
// S0 ようこそ。本番では Cloudflare Access が先にログインを求めるので、主にローカルで見える。
defineEmits<{ start: [] }>();
</script>

<template>
  <main class="flex flex-1 flex-col items-center justify-center gap-8 py-16 text-center">
    <div class="space-y-3">
      <h1 class="text-4xl">そういえば。</h1>
      <p class="text-ink-soft">
        きょうのひとことを残しておくと、<br />
        いつか、ふと思い出すきっかけになります。
      </p>
    </div>
    <button class="btn btn-primary px-10" @click="$emit('start')">はじめる</button>
    <p class="text-sm text-ink-soft">メールに届く確認コードでログインします</p>
  </main>
</template>
