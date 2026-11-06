<script setup lang="ts">
// 画面下の行き先は 2 つだけ。iOS 26 / 27 のタブバーに寄せ、画面の端から浮いたガラスのカプセルにする（ADR-0008）。
// 絵（きょう = 鉛筆、これまで = 押し葉を挟んだ帳面）の下に小さな文字。選択中はアクセント色の塗りの絵と文字にし、
// 後ろに淡い選択の地を敷く（色だけに頼らない: 塗りの絵、地、aria-current。wireframes 6 節）。
defineProps<{ current: "today" | "past" }>();
const items = [
  { id: "today", label: "きょう", href: "#today" },
  { id: "past", label: "これまで", href: "#past" },
] as const;
</script>

<template>
  <nav
    class="pointer-events-none sticky bottom-0 z-10 -mx-[20px] mt-auto px-[21px] pt-2 pb-[max(calc(env(safe-area-inset-bottom)-12px),10px)]"
    aria-label="画面の切り替え"
  >
    <ul class="glass pointer-events-auto mx-auto flex h-[62px] max-w-[360px] items-stretch gap-1 rounded-full p-1">
      <li v-for="item in items" :key="item.id" class="flex flex-1">
        <a
          class="flex flex-1 flex-col items-center justify-center gap-[3px] rounded-full text-[11px] leading-none font-semibold transition-colors duration-200"
          :class="current === item.id ? 'bg-ink/[0.07] text-ember' : 'text-ink'"
          :href="item.href"
          :aria-current="current === item.id ? 'page' : undefined"
        >
          <svg
            width="26"
            height="26"
            viewBox="0 0 24 24"
            stroke="currentColor"
            stroke-width="1.6"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <template v-if="item.id === 'today'">
              <path
                d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4Z"
                :fill="current === item.id ? 'currentColor' : 'none'"
              />
              <path d="M13.5 6.5l4 4" :stroke="current === item.id ? 'var(--color-card)' : 'currentColor'" />
            </template>
            <template v-else>
              <rect x="5.5" y="4" width="13" height="16" rx="2" :fill="current === item.id ? 'currentColor' : 'none'" />
              <path d="M9 4v16" :stroke="current === item.id ? 'var(--color-card)' : 'currentColor'" />
              <path
                d="M11.5 14.5c0-3 2-5 5-5 0 3-2 5-5 5Z"
                fill="none"
                :stroke="current === item.id ? 'var(--color-card)' : 'currentColor'"
              />
            </template>
          </svg>
          {{ item.label }}
        </a>
      </li>
    </ul>
  </nav>
</template>
