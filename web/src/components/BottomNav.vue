<script setup lang="ts">
// 画面下の行き先は 3 つ（きょう / これまで / つながり。3 つめは ADR-0009）。小さな絵（きょう = 鉛筆、これまで = 押し葉を挟んだ帳面、
// つながり = 糸で結んだ 2 枚の紙片）と 14px の文字で示し、選択中は絵の後ろに ember の縁の淡い地を敷いて文字を太くし、
// 絵の鉛筆の軸・押し葉・2 枚の紙片を白く抜く（色だけに頼らない。wireframes 0 節・6 節）。
// 帯は「便箋と押し葉」（ADR-0010）の地と同じ紙（すりガラスにしない）で、上の縁は帳面の綴じ目のような二重罫。
// 帯の高さは pt-1 + 項目 58px + 下の余白（セーフエリアか 6px）で決まり、画面を切り替えても変わらない（wireframes 第8節 #23）。
// 項目は 3 等分（402pt で 1 つ約 123px、375pt で約 114px）。いちばん長い「これまで」「つながり」（4 字）でも折り返さない
import type { From } from "../composables/useScreen";

defineProps<{ current: From }>(); // S3 では開いた元の画面（App.vue）
const items = [
  { id: "today", label: "きょう", href: "#today" },
  { id: "past", label: "これまで", href: "#past" },
  { id: "connections", label: "つながり", href: "#connections" },
] as const;
</script>

<template>
  <nav
    class="tex-desk sticky bottom-0 z-[5] -mx-[20px] mt-auto bg-paper px-4 pt-1 pb-[max(env(safe-area-inset-bottom),6px)] before:absolute before:inset-x-0 before:top-0 before:h-1 before:border-t before:border-b before:border-t-line before:border-b-line/60"
    aria-label="画面の切り替え"
  >
    <ul class="flex">
      <li v-for="item in items" :key="item.id" class="min-w-0 flex-1">
        <a
          class="flex h-[58px] flex-col items-center justify-center gap-[5px] text-sm leading-none tracking-[.08em] whitespace-nowrap [font-feature-settings:'palt']"
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
              <template v-else-if="item.id === 'past'">
                <rect x="5.5" y="4" width="13" height="16" rx="2" />
                <path d="M9 4v16" />
                <path d="M11.5 14.5c0-3 2-5 5-5 0 3-2 5-5 5Z" :class="current === item.id ? 'fill-card' : 'fill-none'" />
              </template>
              <!-- つながり: 書いたひとことと昔のひとことの 2 枚の紙片を、一本の糸で結ぶ（画面の「ふたつの日」と同じ形） -->
              <template v-else>
                <rect x="2.5" y="3" width="8.5" height="6" rx="1.6" transform="rotate(-8 6.75 6)" :class="current === item.id ? 'fill-card' : 'fill-none'" />
                <rect x="13" y="15" width="8.5" height="6" rx="1.6" transform="rotate(7 17.25 18)" :class="current === item.id ? 'fill-card' : 'fill-none'" />
                <path d="M7.2 9.4C7.6 13.6 16.4 10.4 16.8 14.6" />
              </template>
            </svg>
          </span>
          {{ item.label }}
        </a>
      </li>
    </ul>
  </nav>
</template>
