<script setup lang="ts">
// 候補の行（wireframes 2.3）。種別 + 値 + 根拠、「そう」「ちがう」。確定は moss、却下は値に打ち消し線を引いて残す。
import { ref } from "vue";
import { api } from "../api";
import { useNotice } from "../composables/useNotice";
import type { Fact } from "../api/types";
import { formatFactDate } from "../date";

const props = defineProps<{ facts: Fact[]; title?: string }>();
const emit = defineEmits<{ decided: [fact: Fact] }>();

const KIND_LABEL = { person: "人", place: "場所", date: "日", thing: "もの" } as const;
const busy = ref<Set<string>>(new Set());
const notice = useNotice();

const display = (f: Fact) => (f.kind === "date" ? formatFactDate(f.value) : f.value);
const showEvidence = (f: Fact) => f.evidence && f.evidence !== f.value && !f.evidence.startsWith("photo:");

const decide = async (f: Fact, status: "confirmed" | "rejected") => {
  if (busy.value.has(f.id)) return;
  busy.value.add(f.id);
  const prev = f.status;
  f.status = status; // 楽観更新
  try {
    await api.decideFact(f.id, status);
    emit("decided", f);
  } catch {
    f.status = prev; // 表示を戻し、その行の下にそっと知らせる（F4 エラー時）
    notice.show("記録できませんでした", f.id);
  } finally {
    busy.value.delete(f.id);
  }
};
</script>

<template>
  <section v-if="facts.length > 0">
    <h2 class="text-sm text-ink-soft">{{ title ?? "ひとことに出てきたもの" }}</h2>
    <ul class="mt-2 flex flex-col">
      <li
        v-for="f in facts"
        :key="f.id"
        class="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 border-b border-line py-2 last:border-b-0"
      >
        <!-- 種別と値はひとまとまりで行を折り返す単位にする。値と根拠が入りきらない幅（375px の S1 など）では、
             値の列を狭めて単語の途中で割らず、ボタンを次の段の右端に回す（wireframes 2.3）。
             値だけを折り返しの単位にすると、長い根拠のとき種別だけが 1 段目に取り残される -->
        <span class="flex flex-auto items-center gap-x-3">
          <span class="w-8 shrink-0 text-sm text-ink-faint">{{ KIND_LABEL[f.kind] }}</span>
          <span class="flex-1 text-ink">
            <template v-if="f.status === 'candidate' && !showEvidence(f) && f.kind !== 'date'">「{{ display(f) }}」</template>
            <!-- 却下した値は打ち消し線と ink-soft で示す。opacity で薄くすると文字が 4.5:1 を割る。根拠の引用には線を引かない -->
            <span v-else-if="f.status === 'rejected'" class="text-ink-soft line-through">{{ display(f) }}</span>
            <template v-else>{{ display(f) }}</template>
            <span v-if="showEvidence(f)" class="block text-sm text-ink-soft">「{{ f.evidence }}」</span>
          </span>
        </span>
        <!-- 確定の印もボタンと同じ右端に置く（押した瞬間に左へ跳ねない） -->
        <span v-if="f.status === 'candidate'" class="ml-auto flex gap-2">
          <button type="button" class="min-h-11 rounded-full border border-line bg-card px-3.5 text-base text-ink" :disabled="busy.has(f.id)" @click="decide(f, 'confirmed')">そう</button>
          <button type="button" class="min-h-11 rounded-full border border-line bg-card px-3.5 text-base text-ink-soft" :disabled="busy.has(f.id)" @click="decide(f, 'rejected')">ちがう</button>
        </span>
        <span v-else-if="f.status === 'confirmed'" class="ml-auto rounded-full border border-moss bg-moss-soft px-3.5 py-1 text-sm text-ink">✓ そう</span>
        <p v-if="notice.key.value === f.id" class="w-full text-sm text-ink-soft" role="status" aria-live="polite">{{ notice.message.value }}</p>
      </li>
    </ul>
  </section>
</template>
