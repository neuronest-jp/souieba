<script setup lang="ts">
// 画面下の行き先は 2 つだけ。選択中は文字色ではなく上の 2px の線で示す（wireframes 0）。
defineProps<{ current: "today" | "past" }>();
const items = [
  { id: "today", label: "きょう", href: "#today" },
  { id: "past", label: "これまで", href: "#past" },
] as const;
</script>

<template>
  <nav
    class="sticky bottom-0 -mx-5 mt-auto border-t border-line bg-paper/95 px-4 pb-[max(env(safe-area-inset-bottom),8px)] backdrop-blur"
    aria-label="画面の切り替え"
  >
    <ul class="flex">
      <li v-for="item in items" :key="item.id" class="flex-1">
        <a
          class="font-display relative flex h-14 items-center justify-center text-base font-bold"
          :class="current === item.id ? 'text-ink' : 'text-ink-soft'"
          :href="item.href"
          :aria-current="current === item.id ? 'page' : undefined"
        >
          <span v-if="current === item.id" class="absolute inset-x-6 top-0 h-0.5 rounded-full bg-ember" aria-hidden="true"></span>
          {{ item.label }}
        </a>
      </li>
    </ul>
  </nav>
</template>
