<script setup lang="ts">
// 「そういえば。」の札を待つ間（ブラッシュアップ 11/7）。控えの下で、しつけ糸の目が 1 つずつ縫われていく小さな動きと「思い出しています」。
// 札が届いたら呼ぶ側（TodayScreen）が外して札に入れ替える。何も届かずに終わったら leaving で静かに薄れて消える（何も言わない。原則 2）。
// 600ms 待ってから現れるので、すぐ終わるときは見えない。動きは styles/today.css（reduce では縫い終えた形で止まる）。
// 読み上げの知らせ（role="status"）は持たない。後から差し込んだ知らせは読まれないことがあるので、TodayScreen が初めから置いた入れ物に文字を入れる
defineProps<{ leaving?: boolean }>();
// 運針の目 5 つ。形はデータにして v-for で描く（静的な要素を 5 つ以上並べない。テストの最小の DOM のため）
const STITCHES = [0, 1, 2, 3, 4].map((i) => ({ i, x1: 3 + i * 12, x2: 10 + i * 12, y: i % 2 === 0 ? 6.5 : 5.5 }));
</script>

<template>
  <div class="waiting-thread" :class="leaving ? 'is-leaving' : ''">
    <span class="waiting-inner flex min-h-11 items-center gap-2.5">
      <svg width="64" height="12" viewBox="0 0 64 12" fill="none" aria-hidden="true" focusable="false">
        <line v-for="s in STITCHES" :key="s.i" class="waiting-stitch" :x1="s.x1" :x2="s.x2" :y1="s.y" :y2="s.y" :style="{ '--i': s.i }" />
      </svg>
      <span class="text-sm tracking-[.04em] text-ink-soft">思い出しています</span>
    </span>
  </div>
</template>
