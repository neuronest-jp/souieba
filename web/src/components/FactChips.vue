<script setup lang="ts">
// 候補の行（wireframes 2.3）。種別 + 値 + 根拠、「そう」「ちがう」。確定は moss、却下は薄く残す。
import { ref } from "vue";
import { api } from "../api";
import type { Fact } from "../api/types";
import { formatFactDate } from "../date";

const props = defineProps<{ facts: Fact[]; title?: string }>();
const emit = defineEmits<{ decided: [fact: Fact] }>();

const KIND_LABEL = { person: "人", place: "場所", date: "日", thing: "もの" } as const;
const busy = ref<Set<string>>(new Set());

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
    f.status = prev;
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
        :class="f.status === 'rejected' ? 'opacity-50' : ''"
      >
        <span class="w-8 shrink-0 text-sm text-ink-faint">{{ KIND_LABEL[f.kind] }}</span>
        <span class="flex-1 text-ink">
          <template v-if="f.status === 'candidate' && !showEvidence(f) && f.kind !== 'date'">「{{ display(f) }}」</template>
          <template v-else>{{ display(f) }}</template>
          <span v-if="showEvidence(f)" class="block text-sm text-ink-soft">「{{ f.evidence }}」</span>
        </span>
        <span v-if="f.status === 'candidate'" class="flex gap-2">
          <button type="button" class="min-h-11 rounded-full border border-line bg-card px-3.5 text-base text-ink" :disabled="busy.has(f.id)" @click="decide(f, 'confirmed')">そう</button>
          <button type="button" class="min-h-11 rounded-full border border-line bg-card px-3.5 text-base text-ink-soft" :disabled="busy.has(f.id)" @click="decide(f, 'rejected')">ちがう</button>
        </span>
        <span v-else-if="f.status === 'confirmed'" class="rounded-full border border-moss bg-moss-soft px-3.5 py-1 text-sm text-ink">✓ そう</span>
      </li>
    </ul>
  </section>
</template>
