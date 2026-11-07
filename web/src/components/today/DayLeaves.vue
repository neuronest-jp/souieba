<script setup lang="ts">
// このごろ（ブラッシュアップ 11/7）。きょうを右端にした 7 日分の小さな押し葉の列。書いた日（created_at の Asia/Tokyo の日付）は押し葉が押してあり、
// 書いていない日は薄い枠だけ。きょうがまだなら点線の枠で「ここに」と待つ。続けた日数は数えない・出さない（途切れを責めない）。
// 押し葉の形は日付で決まり（同じ日はいつも同じ形）、色は季節で替わる（styles/today.css。季節の色は season.css のトークン）。
// pressToday: きょう初めて残したあとに書く画面へ戻ってきたとき、きょうの押し葉が押される動きを付ける。
// 形はデータにして v-for で描く（テストの最小の DOM は、静的な要素がまとめて挿される形を持たない）
import { computed } from "vue";
import type { TodayDay } from "../../api/types";
import type { Season } from "../../season";

const props = defineProps<{ week: TodayDay[]; season: Season; pressToday?: boolean; animate?: boolean }>();

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"] as const;
// 押し葉の形（24×32。茎は下）: 楕円の葉 / 丸い葉 / 細い葉 / 桂の葉（ハート形）。face が面、rib が葉脈と茎
const SHAPES = [
  { face: "M12 29C4.6 23.6 3.8 12.2 12 3c8.2 9.2 7.4 20.6 0 26Z", rib: "M12 31V7.5" },
  { face: "M12 28.5C4.8 26.8 2.8 17.8 5.6 12 7.8 7.4 12 5.4 12 5.4s4.2 2 6.4 6.6c2.8 5.8.8 14.8-6.4 16.5Z", rib: "M12 31V9.5" },
  { face: "M12 29C7.4 22 7 11.4 12.4 2.6c4.4 9.2 4 19.6-.4 26.4Z", rib: "M12 31 12.3 6" },
  { face: "M12 27.5C5.6 26.4 2.6 21 3.6 15.6 4.6 10.4 8.8 9 12 11.8c3.2-2.8 7.4-1.4 8.4 3.8 1 5.4-2 10.8-8.4 11.9Z", rib: "M12 31V13" },
] as const;

// 日付ごとの形の番号（乱数ではなく文字から決める）
const shapeOf = (date: string) => SHAPES[Array.from(date).reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % SHAPES.length]!;

const slots = computed(() =>
  props.week.map((d, i) => {
    const isToday = i === props.week.length - 1;
    const [y, m, dd] = d.date.split("-").map(Number) as [number, number, number];
    const wd = WEEKDAYS[new Date(y, m - 1, dd).getDay()]!;
    const day = `${m}月${dd}日（${wd}）`;
    const sr = isToday ? `きょう、${day}、${d.wrote ? "書いた日" : "これから"}` : `${day}${d.wrote ? "、書いた日" : ""}`;
    return { ...d, isToday, label: isToday ? "きょう" : wd, sr, shape: shapeOf(d.date) };
  }),
);
</script>

<template>
  <section :data-season="season" :class="animate ? 'today-fade' : ''">
    <h2 class="font-body text-sm leading-[1.6] font-medium tracking-[.06em] text-ink-soft [font-feature-settings:'palt']">このごろ</h2>
    <ol class="day-leaves mt-2">
      <li v-for="s in slots" :key="s.date" class="day-slot" :class="s.isToday ? 'is-today' : ''" :data-date="s.date" :data-wrote="s.wrote ? 'true' : 'false'">
        <span class="day-frame" :class="s.wrote ? '' : s.isToday ? 'is-waiting' : 'is-empty'" aria-hidden="true">
          <svg
            v-if="s.wrote"
            class="day-leaf"
            :class="s.isToday && pressToday ? 'leaf-press' : ''"
            width="23"
            height="31"
            viewBox="0 0 24 32"
            focusable="false"
          >
            <path class="face" :d="s.shape.face" />
            <path class="rib" :d="s.shape.rib" />
          </svg>
          <span v-else-if="s.isToday" class="text-sm leading-none tracking-[.02em] text-ink-soft">ここに</span>
        </span>
        <span class="text-sm leading-[1.4] tracking-[.04em]" :class="s.isToday ? 'font-medium text-ink' : 'text-ink-soft'" aria-hidden="true">{{ s.label }}</span>
        <span class="sr-only">{{ s.sr }}</span>
      </li>
    </ol>
  </section>
</template>
