<script setup lang="ts">
// 起動のときの「そういえば。」の動き（ADR-0008 追記、wireframes 第8節 #26）。
// iOS の起動画面とスプラッシュは止まった画像しか出せないので、同じ画像を 1 字ずつ切った物を同じ位置・同じ大きさに置いて
// 継ぎ目なく引き継ぎ、そこから動かす。文字は画像なので、字体を読み込めない（通信が無い）ときもずれない。
//   1. 字が左から順に小さく浮いて戻る（風が通るように）
//   2. 句点が少し跳ねて落ち、テラコッタの波紋が 2 つ広がる（ふと思い出す、のしずく）
//   3. 画面の準備ができたら（ready）、少なくとも MIN_MS は見せてから静かに消える
// 動きを減らす設定では 1 と 2 を止め、少し見せてから消すだけにする。
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import g0 from "../assets/splash/0.png";
import g1 from "../assets/splash/1.png";
import g2 from "../assets/splash/2.png";
import g3 from "../assets/splash/3.png";
import g4 from "../assets/splash/4.png";
import g5 from "../assets/splash/5.png";
import { SPLASH_MARK } from "../splashMark";

const props = defineProps<{ ready: boolean; seamless: boolean }>();
const emit = defineEmits<{ shown: []; done: [] }>();

const reduce = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
const MIN_MS = reduce ? 600 : 1900;
const FADE_MS = 420;

// 起動画像（2732px 四方）は、iOS では画面いっぱいに縦横比を保って広げられる（aspect fill）。
// 画像の 1px は max(画面の幅, 高さ) / 2732 pt になる（端末の倍率によらない）
const viewport = ref({ w: window.innerWidth, h: window.innerHeight });
const k = computed(() => Math.max(viewport.value.w, viewport.value.h) / 2732);
const onResize = () => (viewport.value = { w: window.innerWidth, h: window.innerHeight });

const glyphs = [g0, g1, g2, g3, g4, g5].map((src, i) => ({ src, ...SPLASH_MARK.glyphs[i]! }));
const leaving = ref(false);
const startedAt = performance.now();
let timer: ReturnType<typeof setTimeout> | undefined;

const leave = () => {
  if (leaving.value) return;
  const wait = Math.max(0, MIN_MS - (performance.now() - startedAt));
  timer = setTimeout(() => {
    leaving.value = true;
    timer = setTimeout(() => emit("done"), FADE_MS);
  }, wait);
};

watch(
  () => props.ready,
  (r) => {
    if (r) leave();
  },
  { immediate: true },
);

onMounted(() => {
  window.addEventListener("resize", onResize);
  // 描かれてから（2 フレーム待つ）ネイティブのスプラッシュを外す。同じ絵なので入れ替わりは見えない
  requestAnimationFrame(() => requestAnimationFrame(() => emit("shown")));
});
onUnmounted(() => {
  window.removeEventListener("resize", onResize);
  if (timer) clearTimeout(timer);
});
</script>

<template>
  <div
    class="splash fixed inset-0 z-50 flex items-center justify-center bg-paper"
    :class="{ 'splash-leaving': leaving, 'splash-fade-in': !seamless, 'splash-still': reduce }"
    aria-hidden="true"
  >
    <div class="relative" :style="{ width: `${SPLASH_MARK.width * k}px`, height: `${SPLASH_MARK.height * k}px` }">
      <img
        v-for="(g, i) in glyphs"
        :key="i"
        :src="g.src"
        alt=""
        class="splash-glyph absolute top-0 max-w-none select-none"
        :class="i === 5 ? 'splash-dot' : 'splash-wave'"
        :style="{
          left: `${g.x * k}px`,
          width: `${g.w * k}px`,
          height: `${SPLASH_MARK.height * k}px`,
          animationDelay: i === 5 ? undefined : `${140 + i * 85}ms`,
        }"
        draggable="false"
      />
      <span
        v-for="n in 2"
        :key="`r${n}`"
        class="splash-ripple absolute rounded-full border-ember"
        :style="{
          left: `${SPLASH_MARK.dot.cx * k}px`,
          top: `${SPLASH_MARK.dot.cy * k}px`,
          width: `${SPLASH_MARK.dot.r * 2.4 * k}px`,
          height: `${SPLASH_MARK.dot.r * 2.4 * k}px`,
          animationDelay: `${1040 + (n - 1) * 200}ms`,
        }"
      ></span>
    </div>
  </div>
</template>

<style scoped>
.splash {
  transition: opacity 420ms cubic-bezier(0.2, 0.7, 0.2, 1);
}
.splash-fade-in {
  animation: splash-in 320ms cubic-bezier(0.2, 0.7, 0.2, 1) both;
}
.splash-leaving {
  opacity: 0;
}
.splash-leaving .splash-glyph {
  transform: translateY(-4px);
  transition: transform 420ms cubic-bezier(0.2, 0.7, 0.2, 1);
}
/* 1. 字が左から順に小さく浮いて戻る */
.splash-wave {
  animation: splash-wave 620ms cubic-bezier(0.45, 0, 0.3, 1) both;
}
/* 2. 句点が少し跳ねて落ちる */
.splash-dot {
  animation: splash-drop 620ms cubic-bezier(0.3, 0, 0.3, 1) 520ms both;
}
.splash-ripple {
  border-width: 1.5px;
  border-style: solid;
  opacity: 0;
  transform: translate(-50%, -50%) scale(0.5);
  /* 始まる前（delay の間）は 0% の形を当てない（輪が元の位置に見えてしまう） */
  animation: splash-ripple 1100ms cubic-bezier(0.1, 0.6, 0.3, 1) forwards;
}
.splash-still .splash-wave,
.splash-still .splash-dot,
.splash-still .splash-ripple {
  animation: none;
}
@keyframes splash-in {
  from {
    opacity: 0;
  }
}
@keyframes splash-wave {
  0%,
  100% {
    transform: translateY(0);
  }
  45% {
    transform: translateY(-9%);
  }
}
@keyframes splash-drop {
  0% {
    transform: translateY(0);
  }
  35% {
    transform: translateY(-22%);
  }
  75% {
    transform: translateY(1.5%);
  }
  88% {
    transform: translateY(-1.5%);
  }
  100% {
    transform: translateY(0);
  }
}
@keyframes splash-ripple {
  0% {
    opacity: 0.6;
    transform: translate(-50%, -50%) scale(0.5);
  }
  100% {
    opacity: 0;
    transform: translate(-50%, -50%) scale(3.4);
  }
}
@media (prefers-reduced-motion: reduce) {
  .splash-wave,
  .splash-dot,
  .splash-ripple,
  .splash-fade-in {
    animation: none;
  }
}
</style>
