<script setup lang="ts">
// 画面下の行き先は 2 つだけ。小さな絵（きょう = 鉛筆、これまで = 押し葉を挟んだ帳面）と 14px の文字で示し、
// 選択中は絵の後ろに ember の縁の淡い地を敷いて文字を太くする（色だけに頼らない。wireframes 0 節・6 節）。
defineProps<{ current: "today" | "past" }>();
const items = [
  { id: "today", label: "きょう", href: "#today" },
  { id: "past", label: "これまで", href: "#past" },
] as const;
</script>

<template>
  <nav
    class="sticky bottom-0 -mx-[20px] mt-auto border-t border-line/70 bg-paper/90 px-4 pb-[max(env(safe-area-inset-bottom),6px)] backdrop-blur-md"
    aria-label="画面の切り替え"
  >
    <ul class="flex">
      <li v-for="item in items" :key="item.id" class="flex-1">
        <a
          class="flex h-14 flex-col items-center justify-center gap-1 text-sm leading-none tracking-[0.06em] [font-feature-settings:'palt']"
          :class="current === item.id ? 'font-bold text-ink' : 'font-medium text-ink-soft'"
          :href="item.href"
          :aria-current="current === item.id ? 'page' : undefined"
        >
          <span
            class="flex h-7 w-14 items-center justify-center rounded-pill border transition-colors duration-200"
            :class="current === item.id ? 'border-ember bg-ember-soft' : 'border-transparent'"
            aria-hidden="true"
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.75"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <template v-if="item.id === 'today'">
                <path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4Z" />
                <path d="M13.5 6.5l4 4" />
              </template>
              <template v-else>
                <rect x="5.5" y="4" width="13" height="16" rx="2" />
                <path d="M9 4v16" />
                <path d="M11.5 14.5c0-3 2-5 5-5 0 3-2 5-5 5Z" />
              </template>
            </svg>
          </span>
          {{ item.label }}
        </a>
      </li>
    </ul>
  </nav>
</template>
