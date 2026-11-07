<script setup lang="ts">
// 画面下の行き先は 2 つだけ。小さな絵（きょう = 鉛筆、これまで = 押し葉を挟んだ帳面）と 14px の文字で示し、
// 選択中は絵の後ろに ember の縁の淡い地を敷いて文字を太くし、絵の鉛筆の軸と押し葉を白く抜く（色だけに頼らない。wireframes 0 節・6 節）。
// 帯は「便箋と押し葉」（ADR-0010）の地と同じ紙（すりガラスにしない）で、上の縁は帳面の綴じ目のような二重罫。
// 帯の高さは pt-1 + 項目 58px + 下の余白（セーフエリアか 6px）で決まり、画面を切り替えても変わらない（wireframes 第8節 #23）
defineProps<{ current: "today" | "past" }>();
const items = [
  { id: "today", label: "きょう", href: "#today" },
  { id: "past", label: "これまで", href: "#past" },
] as const;
</script>

<template>
  <nav
    class="tex-desk sticky bottom-0 z-[5] -mx-[20px] mt-auto bg-paper px-4 pt-1 pb-[max(env(safe-area-inset-bottom),6px)] before:absolute before:inset-x-0 before:top-0 before:h-1 before:border-t before:border-b before:border-t-line before:border-b-line/60"
    aria-label="画面の切り替え"
  >
    <ul class="flex">
      <li v-for="item in items" :key="item.id" class="flex-1">
        <a
          class="flex h-[58px] flex-col items-center justify-center gap-[5px] text-sm leading-none tracking-[.08em] [font-feature-settings:'palt']"
          :class="current === item.id ? 'font-bold text-ink' : 'font-medium text-ink-soft'"
          :href="item.href"
          :aria-current="current === item.id ? 'page' : undefined"
        >
          <span
            class="flex h-7 w-14 items-center justify-center rounded-pill border transition-colors duration-200"
            :class="current === item.id ? 'border-ember bg-ember-soft shadow-highlight' : 'border-transparent'"
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
                <path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4Z" :class="current === item.id ? 'fill-card' : 'fill-none'" />
                <path d="M13.5 6.5l4 4" />
              </template>
              <template v-else>
                <rect x="5.5" y="4" width="13" height="16" rx="2" />
                <path d="M9 4v16" />
                <path d="M11.5 14.5c0-3 2-5 5-5 0 3-2 5-5 5Z" :class="current === item.id ? 'fill-card' : 'fill-none'" />
              </template>
            </svg>
          </span>
          {{ item.label }}
        </a>
      </li>
    </ul>
  </nav>
</template>
