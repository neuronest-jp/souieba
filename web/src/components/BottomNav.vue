<script setup lang="ts">
export type Tab = "today" | "timeline";
const model = defineModel<Tab>({ required: true });
const items: { id: Tab; label: string }[] = [
  { id: "today", label: "きょう" },
  { id: "timeline", label: "これまで" },
];
</script>

<template>
  <nav
    class="sticky bottom-0 -mx-4 mt-auto border-t border-line bg-paper/95 px-4 pb-[max(env(safe-area-inset-bottom),12px)] pt-2 backdrop-blur"
    aria-label="画面の切り替え"
  >
    <ul class="flex gap-2">
      <li v-for="item in items" :key="item.id" class="flex-1">
        <button
          class="font-display w-full rounded-full py-3 text-base font-bold transition-colors duration-200"
          :class="model === item.id ? 'bg-ember-soft text-ink' : 'text-ink-soft hover:bg-card'"
          :aria-current="model === item.id ? 'page' : undefined"
          @click="model = item.id"
        >
          {{ item.label }}
        </button>
      </li>
    </ul>
  </nav>
</template>
